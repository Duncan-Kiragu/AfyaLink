import { describe, expect, it } from "vitest";
import { processVoiceJob } from "./jobs.js";

describe("processVoiceJob", () => {
  it("accepts a mock summary SMS without sending a real message", async () => {
    const result = await processVoiceJob({
      kind: "summary_sms",
      idempotencyKey: "sms:1:1234",
      sessionId: "s1",
      locale: "en",
      phoneLast4: "1234",
    });
    expect(result.event).toBe("voice_sms_mock_sent");
  });

  it("accepts a mock interview callback", async () => {
    const result = await processVoiceJob({
      kind: "interview_callback",
      idempotencyKey: "callback:s1",
      sessionId: "s1",
      locale: "en",
    });
    expect(result.event).toBe("voice_interview_callback_mock");
  });
});
