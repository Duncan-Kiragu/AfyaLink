import { describe, expect, it } from "vitest";
import { signChannelPayload, verifyChannelSignature } from "./signature.js";

const SECRET = "s".repeat(48);
const NOW = 1_800_000_000;
const BODY = JSON.stringify({ message: { text: "chest pain" } });

function sign(body = BODY, timestamp = String(NOW), secret = SECRET): string {
  return signChannelPayload(secret, timestamp, body);
}

describe("verifyChannelSignature", () => {
  it("accepts a correctly signed, fresh payload", () => {
    expect(
      verifyChannelSignature({
        secret: SECRET,
        rawBody: BODY,
        signature: sign(),
        timestamp: String(NOW),
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: true });
  });

  it("rejects a missing signature", () => {
    expect(
      verifyChannelSignature({
        secret: SECRET,
        rawBody: BODY,
        signature: undefined,
        timestamp: String(NOW),
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: false, reason: "missing_signature" });
  });

  it("rejects a missing timestamp", () => {
    expect(
      verifyChannelSignature({
        secret: SECRET,
        rawBody: BODY,
        signature: sign(),
        timestamp: undefined,
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: false, reason: "missing_timestamp" });
  });

  it("rejects a spoofed body that keeps a valid signature", () => {
    expect(
      verifyChannelSignature({
        secret: SECRET,
        rawBody: JSON.stringify({ message: { text: "tampered" } }),
        signature: sign(),
        timestamp: String(NOW),
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(
      verifyChannelSignature({
        secret: SECRET,
        rawBody: BODY,
        signature: sign(BODY, String(NOW), "x".repeat(48)),
        timestamp: String(NOW),
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("rejects a replayed payload outside the skew window", () => {
    const old = NOW - 3_600;
    expect(
      verifyChannelSignature({
        secret: SECRET,
        rawBody: BODY,
        signature: sign(BODY, String(old)),
        timestamp: String(old),
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: false, reason: "stale_timestamp" });
  });

  it("rejects a timestamp from the future beyond the skew window", () => {
    const future = NOW + 3_600;
    expect(
      verifyChannelSignature({
        secret: SECRET,
        rawBody: BODY,
        signature: sign(BODY, String(future)),
        timestamp: String(future),
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: false, reason: "stale_timestamp" });
  });

  it("rejects a non-numeric timestamp", () => {
    expect(
      verifyChannelSignature({
        secret: SECRET,
        rawBody: BODY,
        signature: sign(BODY, "not-a-number"),
        timestamp: "not-a-number",
        nowSeconds: NOW,
      }),
    ).toEqual({ valid: false, reason: "malformed_timestamp" });
  });

  it("binds the signature to the timestamp so it cannot be re-stamped", () => {
    // A valid signature for t=NOW must not verify when presented with a fresher
    // timestamp, otherwise the replay window is unbounded.
    expect(
      verifyChannelSignature({
        secret: SECRET,
        rawBody: BODY,
        signature: sign(BODY, String(NOW)),
        timestamp: String(NOW + 10),
        nowSeconds: NOW + 10,
      }),
    ).toEqual({ valid: false, reason: "signature_mismatch" });
  });
});
