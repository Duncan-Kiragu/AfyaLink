import {
  USSD_MAX_BODY_CHARS,
  ussdProviderRequestSchema,
  type NormalizedInboundMessage,
  type UssdProviderRequest,
  type UssdResponse,
  type VerifiedInboundEvent,
} from "@kkd/contracts";
import type { ChannelIdentityHasher } from "../channel/identity.js";

/**
 * USSD aggregator adapter. V1 targets the Africa's Talking callback shape,
 * which is the dominant Kenyan aggregator: an `application/x-www-form-urlencoded`
 * POST, answered with a plain-text body prefixed `CON ` to keep the dialogue
 * open or `END ` to terminate it.
 *
 * Two provider behaviours are handled deliberately:
 *
 *  - `text` accumulates every keypress joined with `*`. We read only the final
 *    segment and keep authoritative state in Redis, so an aggregator that does
 *    *not* accumulate works through the same code path.
 *  - Aggregators retry a callback when a response is slow. `dedupeKey` gives
 *    the caller a stable idempotency key so a retry replays the previous screen
 *    instead of advancing the state machine twice (spec §11.5).
 */

export const USSD_PROVIDERS = ["africastalking"] as const;
export type UssdProviderName = (typeof USSD_PROVIDERS)[number];

export function parseUssdRequest(body: unknown): UssdProviderRequest {
  return ussdProviderRequestSchema.parse(body);
}

/** The single keypress this callback represents, or `undefined` on first hit. */
export function latestUssdInput(text: string): string | undefined {
  if (text.length === 0) return undefined;
  const segments = text.split("*");
  const last = segments[segments.length - 1];
  return last === undefined || last.length === 0 ? undefined : last;
}

/**
 * Stable per-keypress key. Includes the full accumulated `text` so that a
 * genuine repeat entry ("1" then "1" again at the next step) is a *different*
 * key, while an aggregator retry of the same callback is identical.
 */
export function ussdDedupeKey(request: UssdProviderRequest): string {
  return `${request.sessionId}:${request.text.length}:${request.text}`;
}

export function verifyUssdInbound(
  request: UssdProviderRequest,
  hasher: ChannelIdentityHasher,
): VerifiedInboundEvent {
  return {
    provider: "africastalking",
    channel: "ussd",
    providerMessageId: ussdDedupeKey(request),
    channelUserHash: hasher.hashIdentity("ussd", request.phoneNumber),
    payload: request,
  };
}

export function normalizeUssdInbound(
  event: VerifiedInboundEvent,
  hasher: ChannelIdentityHasher,
): NormalizedInboundMessage {
  const request = event.payload as UssdProviderRequest;
  const input = latestUssdInput(request.text);
  return {
    channel: "ussd",
    provider: "africastalking",
    channelUserHash: event.channelUserHash,
    providerMessageId: event.providerMessageId,
    providerSessionIdHash: hasher.hashProviderSessionId(request.sessionId),
    ...(input === undefined ? {} : { text: input }),
  };
}

/**
 * Renders the provider wire format. USSD screens are hard-capped by the
 * network, so the body is truncated rather than silently dropped by the
 * aggregator; callers should keep screens short enough that this never fires.
 */
export function formatUssdResponse(response: UssdResponse): string {
  const prefix = response.kind === "continue" ? "CON " : "END ";
  return `${prefix}${truncateUssdBody(response.text)}`;
}

export function truncateUssdBody(text: string, max = USSD_MAX_BODY_CHARS): string {
  const collapsed = text.replace(/[ \t]+\n/g, "\n").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/** True when a screen would be truncated, so tests can assert screen budgets. */
export function exceedsUssdBudget(text: string, max = USSD_MAX_BODY_CHARS): boolean {
  return text.trim().length > max;
}
