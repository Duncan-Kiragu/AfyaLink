import { describe, expect, it } from "vitest";
import type { CheckInAnswer, PriorObservation } from "@kkd/contracts";
import { RED_FLAGS_V0_1_0_DRAFT_VERSION } from "../registry.js";
import {
  CHECK_IN_DENIAL_CARRIER_CONCEPT,
  evaluateCheckIn,
  factsFromCheckInAnswers,
  observationsFromCheckInAnswers,
  symptomsFromCheckInAnswers,
} from "./re-evaluation.js";

/** The shipped rule set is `draft` and needs the explicit opt-in (spec §8.3.A). */
const OPTIONS = { executeUnreviewedDraftRules: true } as const;

function severityAnswer(conceptCode: string, value: number): CheckInAnswer {
  return {
    questionId: `${conceptCode}.severity`,
    questionKey: "checkin.question.severity_now",
    conceptCode,
    value,
  };
}

function presenceAnswer(conceptCode: string, value: boolean): CheckInAnswer {
  return {
    questionId: `${conceptCode}.present`,
    questionKey: "checkin.question.still_present",
    conceptCode,
    value,
  };
}

function changeAnswer(conceptCode: string, value: "worse" | "same" | "better"): CheckInAnswer {
  return {
    questionId: `${conceptCode}.change`,
    questionKey: "checkin.question.change_since_last",
    conceptCode,
    value,
  };
}

describe("mapping check-in answers to engine input", () => {
  it("records a rated answer as an explicit symptom", () => {
    expect(symptomsFromCheckInAnswers([severityAnswer("abdominal_pain", 7)])).toEqual([
      {
        id: "checkin.abdominal_pain",
        concept: "abdominal_pain",
        confidence: "explicit",
        severity: 7,
      },
    ]);
  });

  it("records a denial explicitly rather than as silence (spec §5.2)", () => {
    const symptoms = symptomsFromCheckInAnswers([presenceAnswer("vomiting", false)]);
    expect(symptoms).toEqual([
      {
        id: `checkin.${CHECK_IN_DENIAL_CARRIER_CONCEPT}`,
        concept: CHECK_IN_DENIAL_CARRIER_CONCEPT,
        deniedSymptoms: ["vomiting"],
        confidence: "explicit",
      },
    ]);
  });

  it("keeps a present reading when the same concept is both rated and denied", () => {
    const symptoms = symptomsFromCheckInAnswers([
      severityAnswer("abdominal_pain", 9),
      presenceAnswer("abdominal_pain", false),
    ]);
    expect(symptoms).toHaveLength(1);
    expect(symptoms[0]).toMatchObject({ concept: "abdominal_pain", severity: 9 });
  });

  it("carries the patient's own comparison as a fact", () => {
    expect(factsFromCheckInAnswers([changeAnswer("abdominal_pain", "worse")])).toEqual([
      {
        id: "checkin.change.abdominal_pain",
        kind: "checkin.change_since_last.abdominal_pain",
        value: "worse",
        confidence: "explicit",
      },
    ]);
  });

  it("builds one observation per concept for the trend layer", () => {
    const observations = observationsFromCheckInAnswers(
      [severityAnswer("abdominal_pain", 5), changeAnswer("abdominal_pain", "worse")],
      "2026-09-02T08:00:00.000Z",
      (answer) => `entry-${answer.questionId}`,
    );
    expect(observations).toEqual([
      {
        id: "entry-abdominal_pain.severity",
        observedAt: "2026-09-02T08:00:00.000Z",
        conceptCode: "abdominal_pain",
        severity: 5,
        present: true,
        worseningReported: true,
      },
    ]);
  });
});

describe("re-evaluation of a check-in (spec §8.4.E)", () => {
  const priorLowUrgency: PriorObservation[] = [
    {
      observedAt: "2026-09-01T08:00:00.000Z",
      symptoms: [
        {
          id: "s1",
          concept: "abdominal_pain",
          severity: 3,
          confidence: "explicit",
        },
      ],
      facts: [],
      urgency: "monitor",
    },
    {
      observedAt: "2026-09-02T08:00:00.000Z",
      symptoms: [
        {
          id: "s2",
          concept: "abdominal_pain",
          severity: 4,
          confidence: "explicit",
        },
      ],
      facts: [],
      urgency: "monitor",
    },
  ];

  it("lets a worsening follow-up trigger a higher urgency (spec §8.6)", () => {
    const before = evaluateCheckIn(
      {
        answers: [severityAnswer("abdominal_pain", 4), changeAnswer("abdominal_pain", "same")],
        priorObservations: priorLowUrgency,
        ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
        answeredAt: "2026-09-03T08:00:00.000Z",
      },
      OPTIONS,
    );
    expect(before.assessment.urgency).toBe("unknown");

    const worsened = evaluateCheckIn(
      {
        answers: [severityAnswer("abdominal_pain", 9), changeAnswer("abdominal_pain", "worse")],
        priorObservations: priorLowUrgency,
        ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
        answeredAt: "2026-09-04T08:00:00.000Z",
      },
      OPTIONS,
    );
    expect(worsened.assessment.urgency).toBe("urgent_today");
    expect(worsened.assessment.ruleIds).toContain("rf.severe_abdominal_pain_without_relief");
  });

  it("cannot let a profile of low-urgency check-ins suppress a new red flag (spec §8.4.E)", () => {
    const evaluation = evaluateCheckIn(
      {
        answers: [
          presenceAnswer("chest_pain", true),
          presenceAnswer("breathlessness", true),
        ],
        priorObservations: priorLowUrgency,
        ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
        answeredAt: "2026-09-05T08:00:00.000Z",
      },
      OPTIONS,
    );
    expect(evaluation.assessment.urgency).toBe("emergency");
    expect(evaluation.assessment.requiresHumanEscalation).toBe(true);
  });

  it("reaches the same red flag with no history at all", () => {
    // The disposition is a function of the current facts. A long low-urgency history and
    // an empty one give the same answer, which is what "cannot suppress" means.
    const withHistory = evaluateCheckIn(
      {
        answers: [presenceAnswer("chest_pain", true), presenceAnswer("breathlessness", true)],
        priorObservations: priorLowUrgency,
        ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
        answeredAt: "2026-09-05T08:00:00.000Z",
      },
      OPTIONS,
    );
    const withoutHistory = evaluateCheckIn(
      {
        answers: [presenceAnswer("chest_pain", true), presenceAnswer("breathlessness", true)],
        ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
        answeredAt: "2026-09-05T08:00:00.000Z",
      },
      OPTIONS,
    );
    expect(withHistory.assessment.urgency).toBe(withoutHistory.assessment.urgency);
    expect(withHistory.assessment.ruleIds).toEqual(withoutHistory.assessment.ruleIds);
  });

  it("is deterministic for the same answers and rule-set version (spec §8.6)", () => {
    const input = {
      answers: [severityAnswer("abdominal_pain", 9)],
      priorObservations: priorLowUrgency,
      ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
      answeredAt: "2026-09-04T08:00:00.000Z",
    };
    expect(evaluateCheckIn(input, OPTIONS).assessment).toEqual(
      evaluateCheckIn(input, OPTIONS).assessment,
    );
  });

  it("runs synchronously — the disposition is a value, not a promise (spec §8.7)", () => {
    const evaluation = evaluateCheckIn(
      {
        answers: [severityAnswer("abdominal_pain", 9)],
        ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
        answeredAt: "2026-09-04T08:00:00.000Z",
      },
      OPTIONS,
    );
    expect(evaluation.assessment).not.toBeInstanceOf(Promise);
    expect(evaluation.assessment.ruleSetVersion).toBe(RED_FLAGS_V0_1_0_DRAFT_VERSION);
  });
});
