import { describe, expect, it } from "vitest";
import {
  canonicalizePhoneNumber,
  canonicalizeWhatsAppJid,
  createChannelIdentityHasher,
  ChannelIdentityKeyMissingError,
  safeEqual,
} from "./identity.js";

const SALT = "a".repeat(48);
const OTHER_SALT = "b".repeat(48);

describe("canonicalizePhoneNumber", () => {
  it("maps every Kenyan form of one number to the same canonical value", () => {
    const forms = ["+254712345678", "254712345678", "0712345678", "+254 712 345 678"];
    const canonical = forms.map((form) => canonicalizePhoneNumber(form));
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe("254712345678");
  });

  it("handles the 01 prefix range", () => {
    expect(canonicalizePhoneNumber("0110123456")).toBe("254110123456");
  });
});

describe("canonicalizeWhatsAppJid", () => {
  it("strips the server, device suffix, and LID form to one identity", () => {
    const forms = [
      "254712345678@s.whatsapp.net",
      "254712345678:12@s.whatsapp.net",
      "254712345678@lid",
    ];
    const canonical = forms.map(canonicalizeWhatsAppJid);
    expect(new Set(canonical).size).toBe(1);
  });
});

describe("createChannelIdentityHasher", () => {
  it("refuses to run without a sufficiently long salt", () => {
    expect(() => createChannelIdentityHasher(undefined)).toThrow(ChannelIdentityKeyMissingError);
    expect(() => createChannelIdentityHasher("short")).toThrow(ChannelIdentityKeyMissingError);
  });

  it("never returns the raw identity or any digit of it", () => {
    const hasher = createChannelIdentityHasher(SALT);
    const hash = hasher.hashIdentity("whatsapp", "254712345678@s.whatsapp.net");
    expect(hash).not.toContain("254712345678");
    expect(hash).not.toContain("712345678");
    expect(hash.length).toBe(32);
  });

  it("is stable for the same identity and salt", () => {
    const a = createChannelIdentityHasher(SALT);
    const b = createChannelIdentityHasher(SALT);
    expect(a.hashIdentity("whatsapp", "+254712345678")).toBe(
      b.hashIdentity("whatsapp", "254712345678@s.whatsapp.net"),
    );
  });

  it("is keyed: a different salt yields a different pseudonym", () => {
    const a = createChannelIdentityHasher(SALT);
    const b = createChannelIdentityHasher(OTHER_SALT);
    expect(a.hashIdentity("ussd", "+254712345678")).not.toBe(
      b.hashIdentity("ussd", "+254712345678"),
    );
  });

  it("separates namespaces so one number is a different pseudonym per channel", () => {
    const hasher = createChannelIdentityHasher(SALT);
    expect(hasher.hashIdentity("whatsapp", "+254712345678")).not.toBe(
      hasher.hashIdentity("ussd", "+254712345678"),
    );
  });

  it("keeps provider session ids out of the identity namespace", () => {
    const hasher = createChannelIdentityHasher(SALT);
    expect(hasher.hashProviderSessionId("AT_sess_1")).not.toBe(
      hasher.hashIdentity("ussd", "AT_sess_1"),
    );
  });
});

describe("safeEqual", () => {
  it("compares equal strings and rejects mismatched ones without throwing", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
