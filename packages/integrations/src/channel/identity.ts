import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Channel identities (phone numbers, WhatsApp JIDs, USSD provider session ids)
 * are direct identifiers. They are never used as Redis keys or log fields;
 * everything downstream sees a keyed hash instead (spec §11.3B, §11.4A).
 *
 * The hash is keyed, not a bare digest, so a leaked key space cannot be
 * reversed by hashing a national phone-number range.
 */

export class ChannelIdentityKeyMissingError extends Error {
  constructor() {
    super("CHANNEL_IDENTITY_SALT is required to derive pseudonymous channel identities");
    this.name = "ChannelIdentityKeyMissingError";
  }
}

export interface ChannelIdentityHasher {
  /** Hash a sender identity (phone number, JID) into a stable pseudonym. */
  hashIdentity(channel: string, rawIdentity: string): string;
  /** Hash a provider-issued session id (USSD). */
  hashProviderSessionId(rawSessionId: string): string;
}

/** Digits-only, country-code-stable form so `+2547…`, `2547…` and `07…` agree. */
export function canonicalizePhoneNumber(raw: string, defaultCountryCode = "254"): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.startsWith(defaultCountryCode)) return digits;
  // Local Kenyan forms: 07xxxxxxxx / 01xxxxxxxx -> 2547xxxxxxxx / 2541xxxxxxxx
  if (digits.startsWith("0")) return `${defaultCountryCode}${digits.slice(1)}`;
  return digits;
}

/**
 * Strips a WhatsApp JID down to the identity portion. Baileys hands us
 * `2547xxxxxxxx@s.whatsapp.net`, sometimes with a `:device` suffix or a LID
 * (`…@lid`) form, and all of those must map to the same pseudonym.
 */
export function canonicalizeWhatsAppJid(jid: string): string {
  const [user = ""] = jid.split("@");
  const [account = ""] = user.split(":");
  return canonicalizePhoneNumber(account);
}

export function createChannelIdentityHasher(salt: string | undefined): ChannelIdentityHasher {
  if (!salt || salt.length < 32) {
    throw new ChannelIdentityKeyMissingError();
  }
  const digest = (namespace: string, value: string): string =>
    createHmac("sha256", salt).update(`${namespace}:${value}`).digest("base64url").slice(0, 32);

  return {
    hashIdentity(channel, rawIdentity) {
      const canonical =
        channel === "whatsapp"
          ? canonicalizeWhatsAppJid(rawIdentity)
          : canonicalizePhoneNumber(rawIdentity);
      return digest(`identity:${channel}`, canonical || rawIdentity.trim().toLowerCase());
    },
    hashProviderSessionId(rawSessionId) {
      return digest("provider_session", rawSessionId.trim());
    },
  };
}

/** Constant-time compare for HMAC signature verification. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
