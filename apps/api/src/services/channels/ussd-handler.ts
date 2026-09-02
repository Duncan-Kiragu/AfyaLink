import {
  USSD_DEFAULT_TTL_SECONDS,
  type ConversationEngine,
  type UssdProviderRequest,
  type UssdResponse,
  type UssdSessionState,
} from "@kkd/contracts";
import {
  advanceUssdDialogue,
  formatUssdResponse,
  latestUssdInput,
  type UssdSummaryDelivery,
} from "@kkd/integrations/ussd";
import type { ChannelIdentityHasher } from "@kkd/integrations/channel";
import { resolveLocale, t } from "@kkd/i18n";
import { createLogger } from "@kkd/observability";
import { CURRENT_DISCLOSURE_VERSION } from "../disclosure.js";
import type { ChannelSessionStore } from "./channel-session.js";

/**
 * USSD callback orchestration.
 *
 * Resolves (or creates) the dialogue state for a provider session, hands one
 * keypress to the state machine, persists the result, and renders the provider
 * wire format. All clinical behaviour lives behind the shared conversation
 * engine (spec §11.4).
 */

const log = createLogger("api.channels.ussd");

export interface UssdHandlerDeps {
  engine: ConversationEngine;
  channelSessions: ChannelSessionStore;
  hasher: ChannelIdentityHasher;
  summaryDelivery?: UssdSummaryDelivery;
  ttlSeconds?: number;
  now?: () => Date;
}

export interface UssdHandlerResult {
  /** Provider wire body, e.g. `CON 1. English`. */
  body: string;
  response: UssdResponse;
  telemetry: { event: string; language: string; step: string };
}

export async function handleUssdCallback(
  request: UssdProviderRequest,
  deps: UssdHandlerDeps,
): Promise<UssdHandlerResult> {
  const now = deps.now ?? (() => new Date());
  const ttl = deps.ttlSeconds ?? USSD_DEFAULT_TTL_SECONDS;
  const providerSessionIdHash = deps.hasher.hashProviderSessionId(request.sessionId);
  const channelUserHash = deps.hasher.hashIdentity("ussd", request.phoneNumber);
  const input = latestUssdInput(request.text);

  let state = await deps.channelSessions.findUssd(providerSessionIdHash);

  if (!state) {
    // A missing state with a non-empty `text` means the dialogue outlived its
    // Redis TTL. Restarting at the disclosure is the only safe option: we
    // cannot infer what the caller already answered (spec §11.4C, §11.6).
    const turn = await deps.engine.startSession({
      channel: "ussd",
      locale: "en",
      mode: "anonymous_ephemeral",
      channelUserHash,
    });
    const at = now();
    state = {
      providerSessionIdHash,
      channelUserHash,
      sessionId: turn.session.id,
      currentStep: "disclosure",
      locale: "en",
      disclosureVersion: CURRENT_DISCLOSURE_VERSION,
      disclosureAcknowledged: false,
      pendingChoices: [],
      pendingChoiceLabels: {},
      screenCount: 0,
      createdAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + ttl * 1000).toISOString(),
    } satisfies UssdSessionState;

    log.info(
      {
        event: "ussd_session_started",
        channel: "ussd",
        language: state.locale,
        promptVersion: CURRENT_DISCLOSURE_VERSION,
      },
      "presented compressed AI disclosure",
    );

    // First screen always renders the disclosure, ignoring any accumulated
    // input from the expired dialogue.
    const first = await advanceUssdDialogue(state, undefined, {
      engine: deps.engine,
      ...(deps.summaryDelivery ? { summaryDelivery: deps.summaryDelivery } : {}),
    });
    await persist(first.state, deps, ttl, now());
    return result(first.response, first.state);
  }

  const advanced = await advanceUssdDialogue(state, input, {
    engine: deps.engine,
    ...(deps.summaryDelivery ? { summaryDelivery: deps.summaryDelivery } : {}),
  });

  if (advanced.response.kind === "end") {
    // Terminal screen: drop the dialogue state immediately rather than leaving
    // it to expire (spec §16.1 — explicit close deletes at once).
    await deps.channelSessions.removeUssd(providerSessionIdHash);
  } else {
    await persist(advanced.state, deps, ttl, now());
  }

  return result(advanced.response, advanced.state);
}

/** Terminal screen for a callback we could not process safely. */
export function ussdFailureResponse(locale: string): UssdHandlerResult {
  const resolved = resolveLocale(locale);
  const response: UssdResponse = {
    kind: "end",
    text: t(resolved, "channel.service.unavailable"),
  };
  return {
    body: formatUssdResponse(response),
    response,
    telemetry: { event: "ussd_failed", language: resolved, step: "done" },
  };
}

async function persist(
  state: UssdSessionState,
  deps: UssdHandlerDeps,
  ttl: number,
  at: Date,
): Promise<void> {
  await deps.channelSessions.saveUssd({
    ...state,
    expiresAt: new Date(at.getTime() + ttl * 1000).toISOString(),
  });
}

function result(response: UssdResponse, state: UssdSessionState): UssdHandlerResult {
  return {
    body: formatUssdResponse(response),
    response,
    telemetry: {
      event: response.kind === "end" ? "ussd_dialogue_ended" : "ussd_screen_served",
      language: state.locale,
      step: state.currentStep,
    },
  };
}
