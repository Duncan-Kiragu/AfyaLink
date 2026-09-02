import { describe, expect, it } from "vitest";
import { evaluateVoiceSafety } from "./voice-safety.stub.js";
import { createVoiceSession, submitAnswer } from "./voice.service.js";
import { resetVoiceSessions } from "./voice.store.js";

describe("voice safety stub", () => {
  it("returns unknown until required facts exist", () => {
    resetVoiceSessions();
    const record = createVoiceSession("en");
    expect(evaluateVoiceSafety(record).urgency).toBe("unknown");
  });

  it("raises emergency on cannot-breathe language without naming a disease", () => {
    resetVoiceSessions();
    const record = createVoiceSession("en");
    record.disclosureAcknowledged = true;
    submitAnswer(record.session.id, "I cannot breathe and this started an hour ago pain 9/10");
    const safety = evaluateVoiceSafety(record);
    expect(safety.urgency).toBe("emergency");
    expect(safety.ruleSetVersion).toBe("voice-stub.v0");
  });
});
