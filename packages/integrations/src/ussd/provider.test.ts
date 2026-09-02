import { describe, expect, it } from "vitest";
import { USSD_MAX_BODY_CHARS } from "@kkd/contracts";
import {
  exceedsUssdBudget,
  formatUssdResponse,
  latestUssdInput,
  normalizeUssdInbound,
  parseUssdRequest,
  truncateUssdBody,
  ussdDedupeKey,
  verifyUssdInbound,
} from "./provider.js";
import { createChannelIdentityHasher } from "../channel/identity.js";

const hasher = createChannelIdentityHasher("u".repeat(48));

describe("parseUssdRequest", () => {
  it("accepts an Africa's Talking form body and defaults empty text", () => {
    const request = parseUssdRequest({
      sessionId: "AT_1",
      serviceCode: "*384*1#",
      phoneNumber: "+254712345678",
    });
    expect(request.text).toBe("");
  });

  it("rejects a body without a session id or phone number", () => {
    expect(() => parseUssdRequest({ phoneNumber: "+254712345678" })).toThrow();
    expect(() => parseUssdRequest({ sessionId: "AT_1" })).toThrow();
  });
});

describe("latestUssdInput", () => {
  it("returns undefined on the aggregator's first hit", () => {
    expect(latestUssdInput("")).toBeUndefined();
  });

  it("reads only the final segment of accumulated input", () => {
    expect(latestUssdInput("1")).toBe("1");
    expect(latestUssdInput("1*2*7")).toBe("7");
  });

  it("treats a trailing empty segment as no input", () => {
    expect(latestUssdInput("1*")).toBeUndefined();
  });
});

describe("ussdDedupeKey", () => {
  it("is identical for an aggregator retry of the same callback", () => {
    const request = parseUssdRequest({
      sessionId: "AT_1",
      phoneNumber: "+254712345678",
      text: "1*2",
    });
    expect(ussdDedupeKey(request)).toBe(ussdDedupeKey({ ...request }));
  });

  it("differs when the caller presses another key", () => {
    const first = parseUssdRequest({ sessionId: "AT_1", phoneNumber: "+254712345678", text: "1" });
    const second = parseUssdRequest({
      sessionId: "AT_1",
      phoneNumber: "+254712345678",
      text: "1*1",
    });
    expect(ussdDedupeKey(first)).not.toBe(ussdDedupeKey(second));
  });

  it("differs across provider sessions", () => {
    const a = parseUssdRequest({ sessionId: "AT_1", phoneNumber: "+254712345678", text: "1" });
    const b = parseUssdRequest({ sessionId: "AT_2", phoneNumber: "+254712345678", text: "1" });
    expect(ussdDedupeKey(a)).not.toBe(ussdDedupeKey(b));
  });
});

describe("verifyUssdInbound / normalizeUssdInbound", () => {
  const request = parseUssdRequest({
    sessionId: "AT_1",
    phoneNumber: "+254712345678",
    text: "1*3",
  });

  it("hashes the caller identity and the provider session id", () => {
    const event = verifyUssdInbound(request, hasher);
    const normalized = normalizeUssdInbound(event, hasher);

    expect(normalized.channelUserHash).not.toContain("254712345678");
    expect(normalized.providerSessionIdHash).not.toContain("AT_1");
    expect(normalized.providerSessionIdHash).not.toBe(normalized.channelUserHash);
    expect(normalized.text).toBe("3");
    expect(normalized.channel).toBe("ussd");
  });

  it("omits text on the first hit rather than sending an empty string", () => {
    const first = parseUssdRequest({ sessionId: "AT_1", phoneNumber: "+254712345678" });
    const normalized = normalizeUssdInbound(verifyUssdInbound(first, hasher), hasher);
    expect(normalized.text).toBeUndefined();
  });
});

describe("formatUssdResponse", () => {
  it("prefixes CON to keep the dialogue open", () => {
    expect(formatUssdResponse({ kind: "continue", text: "1. English" })).toBe("CON 1. English");
  });

  it("prefixes END to terminate", () => {
    expect(formatUssdResponse({ kind: "end", text: "Session ended." })).toBe("END Session ended.");
  });

  it("keeps the whole wire response inside the provider screen budget", () => {
    const long = "x".repeat(500);
    const wire = formatUssdResponse({ kind: "continue", text: long });
    expect(wire.length).toBeLessThanOrEqual(USSD_MAX_BODY_CHARS + 4);
  });
});

describe("truncateUssdBody", () => {
  it("leaves a short body untouched", () => {
    expect(truncateUssdBody("1. Yes\n2. No")).toBe("1. Yes\n2. No");
  });

  it("marks a truncated body with an ellipsis", () => {
    const truncated = truncateUssdBody("y".repeat(400));
    expect(truncated.length).toBe(USSD_MAX_BODY_CHARS);
    expect(truncated.endsWith("…")).toBe(true);
  });

  it("reports when a screen would overflow", () => {
    expect(exceedsUssdBudget("short")).toBe(false);
    expect(exceedsUssdBudget("y".repeat(400))).toBe(true);
  });
});
