import { createHmac } from "node:crypto";
import { safeEqual } from "./identity.js";

/**
 * Shared HMAC envelope for channel transport.
 *
 * Baileys is a socket client, not a Meta Cloud API webhook, so there is no
 * platform-issued `X-Hub-Signature-256` to verify. The trust boundary moves to
 * the hop between the gateway process and the API, and it is protected with the
 * same discipline the spec requires of a webhook (spec §11.5): signed body,
 * timestamped to bound replay, constant-time comparison.
 *
 * USSD aggregators that support a shared secret use the same scheme; the
 * timestamp header also gives replay protection for providers that reuse
 * session ids.
 */

export const CHANNEL_SIGNATURE_HEADER = "x-kkd-signature";
export const CHANNEL_TIMESTAMP_HEADER = "x-kkd-timestamp";

/** Rejects signatures older/newer than this to bound the replay window. */
export const SIGNATURE_MAX_SKEW_SECONDS = 300;

export function signChannelPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type SignatureFailure =
  | "missing_signature"
  | "missing_timestamp"
  | "malformed_timestamp"
  | "stale_timestamp"
  | "signature_mismatch";

export type SignatureVerification =
  | { valid: true }
  | { valid: false; reason: SignatureFailure };

export function verifyChannelSignature(input: {
  secret: string;
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
  nowSeconds?: number;
  maxSkewSeconds?: number;
}): SignatureVerification {
  const { secret, rawBody, signature, timestamp } = input;
  if (!signature) return { valid: false, reason: "missing_signature" };
  if (!timestamp) return { valid: false, reason: "missing_timestamp" };

  const parsed = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== timestamp.trim()) {
    return { valid: false, reason: "malformed_timestamp" };
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - parsed);
  if (skew > (input.maxSkewSeconds ?? SIGNATURE_MAX_SKEW_SECONDS)) {
    return { valid: false, reason: "stale_timestamp" };
  }

  const expected = signChannelPayload(secret, timestamp, rawBody);
  if (!safeEqual(expected, signature)) {
    return { valid: false, reason: "signature_mismatch" };
  }
  return { valid: true };
}
