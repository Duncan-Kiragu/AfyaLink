import { describe, expect, it } from "vitest";
import { processVoiceCallbacks } from "./voice-callbacks.js";

describe("voice-callbacks processor", () => {
  it("accepts a structured interview-callback payload", async () => {
    await expect(
      processVoiceCallbacks({
        kind: "interview_callback",
        idempotencyKey: "callback:s1",
        sessionId: "s1",
        locale: "en",
      }),
    ).resolves.toBeUndefined();
  });
});
