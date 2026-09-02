import { describe, expect, it } from "vitest";
import type { CheckInObservation } from "@kkd/contracts";
import { buildCheckInQuestions, isRenderableConceptCode } from "./check-in-questions.js";

const history: CheckInObservation[] = [
  {
    id: "entry-1",
    observedAt: "2026-09-01T08:00:00.000Z",
    conceptCode: "abdominal_pain",
    severity: 6,
    present: true,
  },
  {
    id: "entry-2",
    observedAt: "2026-09-01T08:00:00.000Z",
    conceptCode: "vomiting",
    present: true,
  },
];

describe("check-in questions (spec §8.4.C)", () => {
  it("asks a rated symptom for its rating again", () => {
    const questions = buildCheckInQuestions(history);
    const severity = questions.find((question) => question.id === "abdominal_pain.severity");
    expect(severity).toMatchObject({
      questionKey: "checkin.question.severity_now",
      answerShape: "severity_0_10",
      conceptCode: "abdominal_pain",
      params: { conceptCode: "abdominal_pain", previousSeverity: 6 },
      sourceEntryIds: ["entry-1"],
    });
  });

  it("asks an unrated reported symptom whether it is still present", () => {
    const questions = buildCheckInQuestions(history);
    expect(questions.find((question) => question.id === "vomiting.present")).toMatchObject({
      questionKey: "checkin.question.still_present",
      answerShape: "yes_no",
      conceptCode: "vomiting",
    });
  });

  it("asks for the patient's own worse/same/better comparison", () => {
    const questions = buildCheckInQuestions(history);
    expect(questions.find((question) => question.id === "abdominal_pain.change")).toMatchObject({
      questionKey: "checkin.question.change_since_last",
      answerShape: "worse_same_better",
    });
  });

  it("is built only from previously reported facts, never a disease label", () => {
    for (const question of buildCheckInQuestions(history)) {
      expect(question.sourceEntryIds.length).toBeGreaterThan(0);
      for (const entryId of question.sourceEntryIds) {
        expect(history.some((observation) => observation.id === entryId)).toBe(true);
      }
      expect(question.conceptCode).toBeDefined();
      expect(
        history.some((observation) => observation.conceptCode === question.conceptCode),
      ).toBe(true);
    }
  });

  it("carries i18n keys and data, never a rendered sentence", () => {
    for (const question of buildCheckInQuestions(history)) {
      expect(question.questionKey).toMatch(/^checkin\.question\.[a-z_]+$/);
      expect(question.questionKey).not.toContain(" ");
    }
  });

  it("does not re-ask a symptom the patient explicitly denied", () => {
    const questions = buildCheckInQuestions([
      { id: "entry-3", observedAt: "2026-09-01T08:00:00.000Z", conceptCode: "fever", present: false },
    ]);
    expect(questions).toEqual([]);
  });

  it("asks nothing when nothing was previously reported", () => {
    expect(buildCheckInQuestions([])).toEqual([]);
  });

  it("skips a concept code that is not a normalized code", () => {
    const questions = buildCheckInQuestions([
      {
        id: "entry-4",
        observedAt: "2026-09-01T08:00:00.000Z",
        conceptCode: "I think I have malaria",
        severity: 5,
      },
    ]);
    expect(questions).toEqual([]);
  });

  it("caps how many questions one check-in asks", () => {
    const many: CheckInObservation[] = Array.from({ length: 10 }, (_, index) => ({
      id: `entry-${index}`,
      observedAt: `2026-09-0${(index % 9) + 1}T08:00:00.000Z`,
      conceptCode: `symptom_${index}`,
      present: true,
    }));
    expect(buildCheckInQuestions(many, { maxQuestions: 4 })).toHaveLength(4);
  });

  it("is deterministic", () => {
    expect(buildCheckInQuestions(history)).toEqual(buildCheckInQuestions(history));
  });
});

describe("isRenderableConceptCode", () => {
  it("accepts normalized codes and rejects free wording", () => {
    expect(isRenderableConceptCode("abdominal_pain")).toBe(true);
    expect(isRenderableConceptCode("Abdominal Pain")).toBe(false);
    expect(isRenderableConceptCode("my malaria is worse")).toBe(false);
    expect(isRenderableConceptCode("")).toBe(false);
  });
});
