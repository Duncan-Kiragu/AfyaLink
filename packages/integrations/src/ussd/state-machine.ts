import {
  USSD_MAX_SCREENS,
  type ConversationChoice,
  type ConversationPrompt,
  type ConversationTurn,
  type UssdResponse,
  type UssdSessionState,
} from "@kkd/contracts";
import { t, resolveLocale, type SupportedLocale } from "@kkd/i18n";
import { renderChoices, resolveChoiceReply, CHOICE_SYNONYMS } from "../channel/choices.js";
import { exceedsUssdBudget, truncateUssdBody } from "./provider.js";

/**
 * The USSD dialogue driver.
 *
 * Deliberately a pure-ish reducer: it takes the current Redis state plus one
 * keypress and returns the next state and the screen to render. Every clinical
 * decision comes from the injected conversation engine; this file owns screen
 * layout, keypress mapping, and the interaction-depth budget only.
 */

export interface UssdEngine {
  acknowledgeDisclosure(input: {
    sessionId: string;
    disclosureVersion: string;
  }): Promise<ConversationTurn>;
  setLocale(sessionId: string, locale: string): Promise<ConversationTurn>;
  submitPatientMessage(input: {
    sessionId: string;
    text?: string;
    choiceId?: string;
  }): Promise<ConversationTurn>;
  closeSession(sessionId: string): Promise<void>;
}

/** Delivery of the factual summary to another channel, if the caller wants it. */
export interface UssdSummaryDelivery {
  offerAvailable(state: UssdSessionState): Promise<boolean>;
  deliver(state: UssdSessionState): Promise<boolean>;
}

export interface UssdDriverDeps {
  engine: UssdEngine;
  summaryDelivery?: UssdSummaryDelivery;
  /** Fixed clock for deterministic tests. */
  now?: () => Date;
}

export interface UssdAdvanceResult {
  state: UssdSessionState;
  response: UssdResponse;
}

const LANGUAGE_CHOICES: ConversationChoice[] = [
  { id: "en", label: "English", synonyms: ["english", "eng"] },
  { id: "sw", label: "Kiswahili", synonyms: ["kiswahili", "swahili"] },
];

const EXIT_CHOICE: ConversationChoice = {
  id: "exit",
  labelKey: "channel.choice.exit",
  synonyms: [...CHOICE_SYNONYMS.exit],
};

const SUMMARY_CHOICES: ConversationChoice[] = [
  { id: "yes", labelKey: "channel.summary.viaWhatsapp", synonyms: [...CHOICE_SYNONYMS.yes] },
  { id: "no", labelKey: "channel.choice.no", synonyms: [...CHOICE_SYNONYMS.no] },
];

/**
 * Screen 1: compressed disclosure above, language choice below.
 *
 * Disclosure comes first as §15 requires, but it must be legible before a
 * language is known, so this one screen is bilingual and picking a language is
 * the affirmative acknowledgement. Full-length localized disclosure text does
 * not fit a 178-character screen alongside a menu.
 */
export function renderDisclosureScreen(): UssdResponse {
  const body = [
    "KKD uses AI. It does NOT diagnose.",
    "It helps describe symptoms before you see a health worker.",
    "Not for emergencies. Session is temporary, nothing saved.",
    "",
    "1. English",
    "2. Kiswahili",
    "3. Exit",
  ].join("\n");
  return { kind: "continue", text: truncateUssdBody(body) };
}

function labelFor(choice: ConversationChoice, locale: string): string {
  if (choice.labelKey) return t(locale, choice.labelKey);
  return choice.label ?? choice.id;
}

/** Renders an engine prompt as a USSD screen and records what was displayed. */
function renderPrompt(
  prompt: ConversationPrompt,
  locale: SupportedLocale,
): { response: UssdResponse; choiceLabels: Record<string, string> } {
  const head = prompt.messageKey
    ? t(locale, prompt.messageKey, prompt.messageVars)
    : (prompt.text ?? t(locale, "channel.prompt.describe"));

  const choiceLabels: Record<string, string> = {};
  for (const choice of prompt.choices) {
    choiceLabels[choice.id] = labelFor(choice, locale);
  }

  const rendered = renderChoices(prompt.choices, (choice) => choiceLabels[choice.id] ?? choice.id);
  const hint =
    rendered.lines.length > 0
      ? t(locale, "channel.prompt.chooseNumber")
      : prompt.inputKind === "severity_scale"
        ? t(locale, "channel.prompt.severityScale")
        : t(locale, "channel.prompt.freeText");

  const body = [head, "", ...rendered.lines, rendered.lines.length > 0 ? "" : hint]
    .filter((line, index, all) => !(line === "" && all[index - 1] === ""))
    .join("\n");

  return {
    response: { kind: "continue", text: truncateUssdBody(body) },
    choiceLabels,
  };
}

/**
 * The approved deterministic urgency screen for a completed safety check.
 *
 * USSD uses its own reviewed short-form strings (`channel.safety.ussd.*`).
 * The WhatsApp/web wording is longer than a 178-character screen allows, and
 * truncating an approved safety message is not acceptable — so the compressed
 * variants are separate reviewed strings rather than a runtime abbreviation.
 */
export function renderSafetyOutcome(turn: ConversationTurn, locale: SupportedLocale): string {
  const key = turn.degraded.safetyEngineUnavailable
    ? "channel.safety.ussd.unavailable"
    : safetyMessageKey(turn.safety.urgency);
  return t(locale, key);
}

function safetyMessageKey(urgency: ConversationTurn["safety"]["urgency"]): string {
  switch (urgency) {
    case "emergency":
      return "channel.safety.ussd.emergency";
    case "urgent_today":
      return "channel.safety.ussd.urgentToday";
    case "soon":
      return "channel.safety.ussd.soon";
    case "monitor":
      return "channel.safety.ussd.monitor";
    default:
      return "channel.safety.ussd.unknown";
  }
}

function endWith(state: UssdSessionState, text: string): UssdAdvanceResult {
  return {
    state: { ...state, currentStep: "done", pendingChoices: [], pendingChoiceLabels: {} },
    response: { kind: "end", text: truncateUssdBody(text) },
  };
}

/**
 * Advances the dialogue by one keypress.
 *
 * `input` is the latest keypress, or `undefined` on the aggregator's first hit.
 */
export async function advanceUssdDialogue(
  state: UssdSessionState,
  input: string | undefined,
  deps: UssdDriverDeps,
): Promise<UssdAdvanceResult> {
  const locale = resolveLocale(state.locale);
  const next: UssdSessionState = { ...state, screenCount: state.screenCount + 1 };

  // Interaction-depth guard. Better to hand a caller to a professional than to
  // imply a menu-length interview was a complete assessment (spec §11.4C).
  if (next.screenCount > USSD_MAX_SCREENS) {
    await deps.engine.closeSession(state.sessionId).catch(() => undefined);
    return endWith(next, t(locale, "channel.ussd.depthLimited"));
  }

  switch (state.currentStep) {
    case "disclosure":
      return advanceDisclosure(next, input, deps);
    case "language":
      return advanceLanguage(next, input, deps);
    case "conversation":
      return advanceConversation(next, input, deps, locale);
    case "safety_outcome":
      return advanceSafetyOutcome(next, input, deps, locale);
    case "summary_delivery":
      return advanceSummaryDelivery(next, input, deps, locale);
    case "done":
    default:
      return endWith(next, t(locale, "channel.session.closed"));
  }
}

async function advanceDisclosure(
  state: UssdSessionState,
  input: string | undefined,
  deps: UssdDriverDeps,
): Promise<UssdAdvanceResult> {
  if (input === undefined) {
    return {
      state: {
        ...state,
        currentStep: "disclosure",
        pendingChoices: [...LANGUAGE_CHOICES, EXIT_CHOICE],
        pendingChoiceLabels: { en: "English", sw: "Kiswahili", exit: "Exit" },
      },
      response: renderDisclosureScreen(),
    };
  }

  const resolution = resolveChoiceReply(
    input,
    state.pendingChoices.length > 0 ? state.pendingChoices : [...LANGUAGE_CHOICES, EXIT_CHOICE],
    state.pendingChoiceLabels,
  );

  if (resolution.choiceId === "exit" || !resolution.choiceId) {
    if (resolution.choiceId !== "exit") {
      // Unrecognised keypress: re-show the disclosure rather than guessing.
      return { state: { ...state, currentStep: "disclosure" }, response: renderDisclosureScreen() };
    }
    await deps.engine.closeSession(state.sessionId).catch(() => undefined);
    return endWith(state, t(state.locale, "channel.disclosure.declined"));
  }

  const locale = resolveLocale(resolution.choiceId);
  await deps.engine.setLocale(state.sessionId, locale);
  const turn = await deps.engine.acknowledgeDisclosure({
    sessionId: state.sessionId,
    disclosureVersion: state.disclosureVersion,
  });

  return presentTurn({ ...state, locale, disclosureAcknowledged: true }, turn, locale, deps);
}

async function advanceLanguage(
  state: UssdSessionState,
  input: string | undefined,
  deps: UssdDriverDeps,
): Promise<UssdAdvanceResult> {
  const locale = resolveLocale(state.locale);
  if (input === undefined) {
    const labels = { en: "English", sw: "Kiswahili" };
    const rendered = renderChoices(LANGUAGE_CHOICES, (choice) => labels[choice.id as "en" | "sw"]);
    return {
      state: { ...state, pendingChoices: LANGUAGE_CHOICES, pendingChoiceLabels: labels },
      response: {
        kind: "continue",
        text: truncateUssdBody(
          [t(locale, "channel.language.prompt"), "", ...rendered.lines].join("\n"),
        ),
      },
    };
  }

  const resolution = resolveChoiceReply(input, LANGUAGE_CHOICES, state.pendingChoiceLabels);
  const chosen = resolveLocale(resolution.choiceId ?? state.locale);
  const turn = await deps.engine.setLocale(state.sessionId, chosen);
  return presentTurn({ ...state, locale: chosen }, turn, chosen, deps);
}

async function advanceConversation(
  state: UssdSessionState,
  input: string | undefined,
  deps: UssdDriverDeps,
  locale: SupportedLocale,
): Promise<UssdAdvanceResult> {
  if (input === undefined) {
    // Aggregator re-hit without a keypress; re-render nothing new is known, so
    // ask the engine for the current prompt by submitting an empty turn.
    const turn = await deps.engine.submitPatientMessage({ sessionId: state.sessionId });
    return presentTurn(state, turn, locale, deps);
  }

  // "0" is reserved on every USSD screen for changing language.
  if (input.trim() === "0") {
    return advanceLanguage({ ...state, currentStep: "language" }, undefined, deps);
  }

  const resolution = resolveChoiceReply(input, state.pendingChoices, state.pendingChoiceLabels);
  const turn = await deps.engine.submitPatientMessage({
    sessionId: state.sessionId,
    ...(resolution.choiceId === undefined ? {} : { choiceId: resolution.choiceId }),
    ...(resolution.text === undefined ? {} : { text: resolution.text }),
  });
  return presentTurn(state, turn, locale, deps);
}

async function advanceSafetyOutcome(
  state: UssdSessionState,
  input: string | undefined,
  deps: UssdDriverDeps,
  locale: SupportedLocale,
): Promise<UssdAdvanceResult> {
  // The caller has read the urgency screen. Anything other than "continue"
  // ends the dialogue; the guidance has already been delivered.
  const resolution = resolveChoiceReply(input ?? "", state.pendingChoices, state.pendingChoiceLabels);
  if (resolution.choiceId !== "continue") {
    await deps.engine.closeSession(state.sessionId).catch(() => undefined);
    return endWith(state, t(locale, "channel.session.closed"));
  }
  return offerSummary(state, locale, deps);
}

async function advanceSummaryDelivery(
  state: UssdSessionState,
  input: string | undefined,
  deps: UssdDriverDeps,
  locale: SupportedLocale,
): Promise<UssdAdvanceResult> {
  const resolution = resolveChoiceReply(input ?? "", SUMMARY_CHOICES, state.pendingChoiceLabels);
  if (resolution.choiceId === "yes" && deps.summaryDelivery) {
    const delivered = await deps.summaryDelivery.deliver(state).catch(() => false);
    await deps.engine.closeSession(state.sessionId).catch(() => undefined);
    return endWith(
      state,
      delivered ? t(locale, "channel.summary.ready") : t(locale, "channel.summary.unavailable"),
    );
  }
  await deps.engine.closeSession(state.sessionId).catch(() => undefined);
  return endWith(state, t(locale, "channel.session.closed"));
}

/** Turns an engine turn into the next screen, honouring red-flag interrupts. */
async function presentTurn(
  state: UssdSessionState,
  turn: ConversationTurn,
  locale: SupportedLocale,
  deps: UssdDriverDeps,
): Promise<UssdAdvanceResult> {
  // A red flag ends the dialogue immediately with the approved message. It is
  // never queued behind further questioning (spec §8.3B, §11.7).
  if (turn.prompt.interrupt || turn.safety.urgency === "emergency") {
    await deps.engine.closeSession(state.sessionId).catch(() => undefined);
    return endWith(state, renderSafetyOutcome(turn, locale));
  }

  if (turn.prompt.kind === "safety_notice" || turn.prompt.kind === "summary") {
    return presentSafetyOutcome(state, renderSafetyOutcome(turn, locale), locale, deps);
  }

  if (turn.prompt.kind === "closed") {
    return endWith(state, t(locale, "channel.session.closed"));
  }

  if (turn.prompt.kind === "service_notice") {
    return endWith(
      state,
      turn.prompt.messageKey
        ? t(locale, turn.prompt.messageKey)
        : t(locale, "channel.service.unavailable"),
    );
  }

  const { response, choiceLabels } = renderPrompt(turn.prompt, locale);
  return {
    state: {
      ...state,
      currentStep: "conversation",
      locale,
      pendingChoices: turn.prompt.choices,
      pendingChoiceLabels: choiceLabels,
      ...(turn.prompt.targetFieldId === undefined
        ? {}
        : { pendingFieldId: turn.prompt.targetFieldId }),
    },
    response,
  };
}

/**
 * Delivers the approved urgency message.
 *
 * An approved safety message must never be truncated, so it is not combined
 * with a menu unless the whole screen provably fits the provider budget. When
 * it does not fit, the outcome gets a screen of its own and the summary offer
 * moves to the next one. If there is nothing to offer, the outcome is the
 * terminal screen and no extra screen is spent.
 */
async function presentSafetyOutcome(
  state: UssdSessionState,
  outcomeText: string,
  locale: SupportedLocale,
  deps: UssdDriverDeps,
): Promise<UssdAdvanceResult> {
  const available = deps.summaryDelivery
    ? await deps.summaryDelivery.offerAvailable(state).catch(() => false)
    : false;

  if (!available) {
    await deps.engine.closeSession(state.sessionId).catch(() => undefined);
    return endWith(state, outcomeText);
  }

  const offer = renderSummaryOffer(locale);
  const combined = `${outcomeText}\n\n${offer.body}`;
  if (!exceedsUssdBudget(combined)) {
    return {
      state: {
        ...state,
        currentStep: "summary_delivery",
        pendingChoices: SUMMARY_CHOICES,
        pendingChoiceLabels: offer.labels,
      },
      response: { kind: "continue", text: combined },
    };
  }

  const continueChoice: ConversationChoice = {
    id: "continue",
    labelKey: "channel.choice.continue",
    synonyms: [...CHOICE_SYNONYMS.continue],
  };
  const labels = { continue: labelFor(continueChoice, locale) };
  const rendered = renderChoices([continueChoice], () => labels.continue);
  const withContinue = `${outcomeText}\n\n${rendered.lines.join("\n")}`;

  // Last resort: if even one extra option would push the screen over budget,
  // drop the optional summary offer and end on the intact safety message. A
  // truncated safety message, or a truncated option the caller cannot read, is
  // never the right trade.
  if (exceedsUssdBudget(withContinue)) {
    await deps.engine.closeSession(state.sessionId).catch(() => undefined);
    return endWith(state, outcomeText);
  }

  return {
    state: {
      ...state,
      currentStep: "safety_outcome",
      pendingChoices: [continueChoice],
      pendingChoiceLabels: labels,
    },
    response: { kind: "continue", text: withContinue },
  };
}

function renderSummaryOffer(locale: SupportedLocale): {
  body: string;
  labels: Record<string, string>;
} {
  const labels: Record<string, string> = {};
  for (const choice of SUMMARY_CHOICES) labels[choice.id] = labelFor(choice, locale);
  const rendered = renderChoices(SUMMARY_CHOICES, (choice) => labels[choice.id] ?? choice.id);
  return {
    body: [t(locale, "channel.summary.offer"), ...rendered.lines].join("\n"),
    labels,
  };
}

async function offerSummary(
  state: UssdSessionState,
  locale: SupportedLocale,
  deps: UssdDriverDeps,
): Promise<UssdAdvanceResult> {
  const available = deps.summaryDelivery
    ? await deps.summaryDelivery.offerAvailable(state).catch(() => false)
    : false;

  if (!available) {
    await deps.engine.closeSession(state.sessionId).catch(() => undefined);
    return endWith(state, t(locale, "channel.session.closed"));
  }

  const offer = renderSummaryOffer(locale);
  return {
    state: {
      ...state,
      currentStep: "summary_delivery",
      pendingChoices: SUMMARY_CHOICES,
      pendingChoiceLabels: offer.labels,
    },
    response: { kind: "continue", text: truncateUssdBody(offer.body) },
  };
}
