import { describe, expect, it } from "vitest";
import {
  acknowledgeDisclosure,
  buildSummary,
  cancelInterviewCallback,
  createVoiceSession,
  DISCLOSURE_VERSION,
  nextQuestion,
  requestInterviewCallback,
  submitAnswer,
} from "./voice.service.js";
import { resetVoiceSessions } from "./voice.store.js";

describe("voice session facade", () => {
  it("blocks answers before disclosure", async () => {
    resetVoiceSessions();
    const record = createVoiceSession("en");
    await expect(submitAnswer(record.session.id, "headache")).rejects.toThrow(/disclosure/);
  });

  it("does not treat a self-label as a diagnosis concept", async () => {
    resetVoiceSessions();
    const record = createVoiceSession("en");
    acknowledgeDisclosure(record.session.id, DISCLOSURE_VERSION);
    const updated = await submitAnswer(record.session.id, "I think I have malaria, my head hurts 6/10 since yesterday");
    expect(updated.session.symptoms.some((item) => item.concept === "unspecified_symptom")).toBe(
      true,
    );
    const summary = buildSummary(updated);
    expect(summary.recommendedNextAction.toLowerCase()).not.toContain("malaria");
    expect(summary.model).toBe("none-deterministic-stub");
    expect(nextQuestion(updated)).toMatch(/experiencing/i);
  });

  it("cancels a requested interview callback", () => {
    resetVoiceSessions();
    const record = createVoiceSession("en");
    acknowledgeDisclosure(record.session.id, DISCLOSURE_VERSION);
    requestInterviewCallback(record);
    expect(record.callbackStatus).toBe("requested");
    const cancelled = cancelInterviewCallback(record.session.id);
    expect(cancelled.callbackStatus).toBe("cancelled");
  });
});
