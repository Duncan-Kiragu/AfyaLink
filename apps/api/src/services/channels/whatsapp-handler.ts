import {
  type ChannelSession,
  type ConversationEngine,
  type ConversationPrompt,
  type ConversationTurn,
  type NormalizedInboundMessage,
  type OutboundChannelMessage,
} from "@kkd/contracts";
import { parseChannelCommand, resolveChoiceReply } from "@kkd/integrations/channel";
import { resolveLocale, t, type SupportedLocale } from "@kkd/i18n";
import { createLogger } from "@kkd/observability";
import { CURRENT_DISCLOSURE_VERSION, getDisclosure } from "../disclosure.js";
import {
  newChannelSession,
  type ChannelSessionStore,
} from "./channel-session.js";

/**
 * WhatsApp conversation orchestration.
 *
 * Owns channel interaction state only: session mapping, disclosure gating,
 * keyword commands, choice rendering, and the media policy. Every clinical
 * decision is delegated to the shared conversation engine (spec §11.1).
 */

const log = createLogger("api.channels.whatsapp");

export interface WhatsAppHandlerDeps {
  engine: ConversationEngine;
  channelSessions: ChannelSessionStore;
  maxLifetimeSeconds: number;
  now?: () => Date;
}

export interface WhatsAppReply {
  messages: OutboundChannelMessage[];
  /** Safe telemetry only — no message content (spec §18). */
  telemetry: {
    event: string;
    urgency?: string;
    language: string;
    disclosureShown: boolean;
    aiUnavailable?: boolean;
  };
}

export async function handleWhatsAppInbound(
  inbound: NormalizedInboundMessage,
  deps: WhatsAppHandlerDeps,
): Promise<WhatsAppReply> {
  const now = deps.now ?? (() => new Date());
  const lookup = await deps.channelSessions.find("whatsapp", inbound.channelUserHash);
  const existing = lookup.session;
  const locale = resolveLocale(inbound.locale ?? existing?.locale);

  // Media is recognised and refused. Nothing is downloaded, decrypted, or sent
  // to a third party (spec §11.3E).
  if (inbound.rejection) {
    return {
      messages: [
        message(inbound.channelUserHash, locale, rejectionKey(inbound.rejection), inbound),
      ],
      telemetry: { event: "whatsapp_inbound_rejected", language: locale, disclosureShown: false },
    };
  }

  const command = parseChannelCommand(inbound.text);

  if (command === "close" && existing) {
    await deps.engine.closeSession(existing.sessionId).catch(() => undefined);
    await deps.channelSessions.remove("whatsapp", inbound.channelUserHash);
    return {
      messages: [
        message(inbound.channelUserHash, locale, "channel.session.closed", inbound, {
          terminal: true,
        }),
      ],
      telemetry: { event: "whatsapp_session_closed", language: locale, disclosureShown: false },
    };
  }

  // No active session, or the disclosure version moved on: start over with the
  // disclosure (spec §11.3C). The "your session expired" notice is added only
  // when expiry was actually observable — see `ChannelSessionLookup`.
  if (!existing || !isDisclosureCurrentFor(existing)) {
    const supersededDisclosure = Boolean(existing);
    if (existing) {
      await deps.engine.closeSession(existing.sessionId).catch(() => undefined);
      await deps.channelSessions.remove("whatsapp", inbound.channelUserHash);
    }
    return startWithDisclosure(
      inbound,
      locale,
      lookup.expired || supersededDisclosure,
      deps,
      now(),
    );
  }

  let session = await deps.channelSessions.touch(existing);

  if (command === "language") {
    return offerLanguage(inbound, session);
  }

  // A pending disclosure blocks the clinical path entirely.
  if (!session.disclosureAcknowledgedAt) {
    return acknowledgeOrReprompt(inbound, session, locale, deps);
  }

  if (command === "help") {
    return {
      messages: [
        message(inbound.channelUserHash, session.locale, "channel.language.hint", inbound),
      ],
      telemetry: { event: "whatsapp_help", language: session.locale, disclosureShown: false },
    };
  }

  /**
   * The channel mapping and the engine session have independent TTLs, so the
   * engine session can be gone while the mapping survives. Rather than
   * surfacing an error to a patient mid-conversation, drop the stale mapping
   * and start over from the disclosure.
   */
  const withRecovery = async (
    run: () => Promise<WhatsAppReply>,
  ): Promise<WhatsAppReply> => {
    try {
      return await run();
    } catch (error) {
      if (!isSessionGone(error)) throw error;
      await deps.channelSessions.remove("whatsapp", inbound.channelUserHash);
      return startWithDisclosure(inbound, locale, true, deps, now());
    }
  };

  if (command === "start") {
    return withRecovery(async () => {
      const turn = await deps.engine.getSession(session.sessionId);
      if (!turn) throw new StaleChannelSessionError();
      return renderTurn(inbound, session, turn, deps);
    });
  }

  const languageChoice = resolveLanguageSelection(inbound.text);
  if (languageChoice) {
    return withRecovery(async () => {
      const turn = await deps.engine.setLocale(session.sessionId, languageChoice);
      session = await persistLocale(session, languageChoice, deps);
      const reply = await renderTurn(inbound, session, turn, deps);
      reply.messages.unshift(
        message(inbound.channelUserHash, languageChoice, "channel.language.changed", inbound),
      );
      return reply;
    });
  }

  if (command === "summary") {
    return withRecovery(async () =>
      renderTurn(inbound, session, await deps.engine.getSummary(session.sessionId), deps),
    );
  }

  return withRecovery(async () => {
    const turn = await deps.engine.submitPatientMessage({
      sessionId: session.sessionId,
      ...(inbound.choiceId === undefined ? {} : { choiceId: inbound.choiceId }),
      ...(inbound.text === undefined ? {} : { text: inbound.text }),
    });
    return renderTurn(inbound, session, turn, deps);
  });
}

/** Raised when the mapping outlived the engine session it points at. */
class StaleChannelSessionError extends Error {
  constructor() {
    super("channel session points at an expired conversation session");
    this.name = "SessionNotFoundError";
  }
}

function isSessionGone(error: unknown): boolean {
  return error instanceof Error && error.name === "SessionNotFoundError";
}

async function startWithDisclosure(
  inbound: NormalizedInboundMessage,
  locale: SupportedLocale,
  afterExpiry: boolean,
  deps: WhatsAppHandlerDeps,
  at: Date,
): Promise<WhatsAppReply> {
  const turn = await deps.engine.startSession({
    channel: "whatsapp",
    locale,
    mode: "anonymous_ephemeral",
    channelUserHash: inbound.channelUserHash,
  });

  await deps.channelSessions.save(
    newChannelSession({
      channel: "whatsapp",
      channelUserHash: inbound.channelUserHash,
      sessionId: turn.session.id,
      locale,
      disclosureVersion: CURRENT_DISCLOSURE_VERSION,
      maxLifetimeSeconds: deps.maxLifetimeSeconds,
      now: at,
    }),
  );

  const disclosure = getDisclosure("whatsapp", locale);
  const messages: OutboundChannelMessage[] = [];
  if (afterExpiry) {
    messages.push(message(inbound.channelUserHash, locale, "channel.session.expired", inbound));
  }
  messages.push({
    channel: "whatsapp",
    channelUserHash: inbound.channelUserHash,
    text: disclosure.text,
    choices: [],
    choiceLabels: {},
    locale,
    urgent: false,
    terminal: false,
    ...(inbound.providerMessageId
      ? { replyToProviderMessageId: inbound.providerMessageId }
      : {}),
  });

  log.info(
    {
      event: "whatsapp_disclosure_presented",
      channel: "whatsapp",
      language: locale,
      promptVersion: CURRENT_DISCLOSURE_VERSION,
    },
    "presented AI disclosure",
  );

  return {
    messages,
    telemetry: { event: "whatsapp_session_started", language: locale, disclosureShown: true },
  };
}

async function acknowledgeOrReprompt(
  inbound: NormalizedInboundMessage,
  session: ChannelSession,
  locale: SupportedLocale,
  deps: WhatsAppHandlerDeps,
): Promise<WhatsAppReply> {
  const acknowledged = resolveChoiceReply(
    inbound.text ?? "",
    [
      {
        id: "acknowledge",
        labelKey: "disclosure.acknowledge",
        synonyms: ["1", "ok", "okay", "yes", "ndiyo", "sawa", "nimeelewa", "understood"],
      },
    ],
    {},
  );

  if (acknowledged.choiceId !== "acknowledge") {
    return {
      messages: [
        message(inbound.channelUserHash, locale, "channel.disclosure.required", inbound),
      ],
      telemetry: {
        event: "whatsapp_disclosure_pending",
        language: locale,
        disclosureShown: true,
      },
    };
  }

  const turn = await deps.engine.acknowledgeDisclosure({
    sessionId: session.sessionId,
    disclosureVersion: session.disclosureVersion,
  });
  const updated: ChannelSession = {
    ...session,
    disclosureAcknowledgedAt: new Date().toISOString(),
  };
  await deps.channelSessions.save(updated);
  return renderTurn(inbound, updated, turn, deps);
}

async function offerLanguage(
  inbound: NormalizedInboundMessage,
  session: ChannelSession,
): Promise<WhatsAppReply> {
  const locale = resolveLocale(session.locale);
  return {
    messages: [
      {
        channel: "whatsapp",
        channelUserHash: inbound.channelUserHash,
        text: t(locale, "channel.language.prompt"),
        choices: [
          { id: "en", labelKey: "channel.language.en", synonyms: ["english", "eng"] },
          { id: "sw", labelKey: "channel.language.sw", synonyms: ["kiswahili", "swahili"] },
        ],
        choiceLabels: { en: "English", sw: "Kiswahili" },
        locale,
        urgent: false,
        terminal: false,
        replyToProviderMessageId: inbound.providerMessageId,
      },
    ],
    telemetry: { event: "whatsapp_language_offered", language: locale, disclosureShown: false },
  };
}

/** Detects a bare language selection so `LANG` -> a reply completes the switch. */
function resolveLanguageSelection(text: string | undefined): SupportedLocale | undefined {
  if (!text) return undefined;
  const normalized = text.trim().toLowerCase();
  if (normalized === "english" || normalized === "eng") return "en";
  if (normalized === "kiswahili" || normalized === "swahili") return "sw";
  return undefined;
}

async function persistLocale(
  session: ChannelSession,
  locale: SupportedLocale,
  deps: WhatsAppHandlerDeps,
): Promise<ChannelSession> {
  const updated: ChannelSession = { ...session, locale };
  await deps.channelSessions.save(updated);
  return updated;
}

/** Renders an engine turn into WhatsApp messages. */
async function renderTurn(
  inbound: NormalizedInboundMessage,
  session: ChannelSession,
  turn: ConversationTurn,
  deps: WhatsAppHandlerDeps,
): Promise<WhatsAppReply> {
  const locale = resolveLocale(turn.session.locale ?? session.locale);
  const messages: OutboundChannelMessage[] = [];

  if (turn.degraded.aiUnavailable) {
    messages.push(
      message(inbound.channelUserHash, locale, "channel.service.aiUnavailable", inbound),
    );
  }

  messages.push(renderPromptMessage(inbound, locale, turn.prompt));

  if (turn.prompt.kind === "summary" && turn.summary) {
    messages.push({
      channel: "whatsapp",
      channelUserHash: inbound.channelUserHash,
      text: formatSummary(turn.summary, locale),
      choices: [],
      choiceLabels: {},
      locale,
      urgent: false,
      terminal: false,
      replyToProviderMessageId: inbound.providerMessageId,
    });
    // WhatsApp participation is never itself consent to persist (spec §11.3F).
    messages.push(
      message(inbound.channelUserHash, locale, "channel.persistence.notAvailable", inbound),
    );
  }

  if (turn.prompt.interrupt) {
    // A red flag ends the interview. Drop the channel mapping too, so the next
    // message starts a clean disclosed session rather than pointing at a
    // session that no longer exists.
    await deps.engine.closeSession(session.sessionId).catch(() => undefined);
    await deps.channelSessions.remove("whatsapp", session.channelUserHash);
  }

  return {
    messages,
    telemetry: {
      event: "whatsapp_turn_rendered",
      urgency: turn.safety.urgency,
      language: locale,
      disclosureShown: turn.prompt.kind === "disclosure",
      aiUnavailable: turn.degraded.aiUnavailable,
    },
  };
}

function renderPromptMessage(
  inbound: NormalizedInboundMessage,
  locale: SupportedLocale,
  prompt: ConversationPrompt,
): OutboundChannelMessage {
  // Safety-critical output renders from the reviewed key even when the model
  // supplied wording (spec §10.4A).
  const safetyCritical =
    prompt.kind === "safety_notice" ||
    prompt.kind === "disclosure" ||
    prompt.kind === "closed" ||
    prompt.kind === "service_notice";

  const text =
    safetyCritical && prompt.messageKey
      ? t(locale, prompt.messageKey, prompt.messageVars)
      : (prompt.text ??
        (prompt.messageKey
          ? t(locale, prompt.messageKey, prompt.messageVars)
          : t(locale, "channel.prompt.describe")));

  const choiceLabels: Record<string, string> = {};
  for (const choice of prompt.choices) {
    choiceLabels[choice.id] = choice.labelKey
      ? t(locale, choice.labelKey)
      : (choice.label ?? choice.id);
  }

  return {
    channel: "whatsapp",
    channelUserHash: inbound.channelUserHash,
    text,
    choices: prompt.choices,
    choiceLabels,
    locale,
    urgent: prompt.interrupt || prompt.kind === "safety_notice",
    terminal: prompt.kind === "closed" || prompt.interrupt,
    replyToProviderMessageId: inbound.providerMessageId,
  };
}

/**
 * Renders the factual handover summary. Sections mirror the web summary
 * (spec §10.3C) and there is deliberately no "possible diagnosis" section.
 */
function formatSummary(summary: NonNullable<ConversationTurn["summary"]>, locale: string): string {
  const section = (label: string, values: readonly string[]): string[] =>
    values.length === 0 ? [] : [`*${label}*`, ...values.map((value) => `• ${value}`), ""];

  return [
    `*${t(locale, "channel.summary.ready")}*`,
    "",
    summary.reasonForSeekingCare,
    "",
    ...section("Symptoms reported", summary.symptomsReported),
    ...(summary.timeline ? [`*Timeline*`, summary.timeline, ""] : []),
    ...section("Severity / measurements", summary.severityAndMeasurements),
    ...section("Associated symptoms", summary.associatedSymptoms),
    ...section("Explicitly denied", summary.symptomsExplicitlyDenied),
    ...section("Medication reported", summary.medicationAlreadyTaken),
    ...section("Relevant context", summary.relevantContext),
    ...section("Not established", summary.unknownOrUnanswered),
    `*Next action*`,
    summary.recommendedNextAction,
  ]
    .join("\n")
    .trim();
}

function message(
  channelUserHash: string,
  locale: string,
  messageKey: string,
  inbound: NormalizedInboundMessage,
  overrides: Partial<OutboundChannelMessage> = {},
): OutboundChannelMessage {
  return {
    channel: "whatsapp",
    channelUserHash,
    text: t(locale, messageKey),
    choices: [],
    choiceLabels: {},
    locale: resolveLocale(locale),
    urgent: false,
    terminal: false,
    replyToProviderMessageId: inbound.providerMessageId,
    ...overrides,
  };
}

function rejectionKey(rejection: NonNullable<NormalizedInboundMessage["rejection"]>): string {
  switch (rejection) {
    case "unsupported_media":
      return "channel.media.unsupported";
    case "too_long":
      return "channel.message.tooLong";
    default:
      return "channel.message.empty";
  }
}

function isDisclosureCurrentFor(session: ChannelSession): boolean {
  return session.disclosureVersion === CURRENT_DISCLOSURE_VERSION;
}
