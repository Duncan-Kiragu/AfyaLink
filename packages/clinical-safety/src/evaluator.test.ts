import {
  severityEvaluationInputSchema,
  type ReportedFact,
  type ReportedSymptom,
} from "@kkd/contracts";
import { describe, expect, it } from "vitest";
import { DeterministicSafetyEngine, evaluateSeverity } from "./evaluator.js";
import {
  defineRuleSet,
  RuleSetRegistry,
  UnknownRuleSetVersionError,
} from "./registry.js";
import { RED_FLAGS_V0_1_0_DRAFT_VERSION } from "./rule-sets/red-flags.v0.1.0-draft.js";

const RULE_SET = RED_FLAGS_V0_1_0_DRAFT_VERSION;

function symptom(concept: string, extra: Partial<ReportedSymptom> = {}): ReportedSymptom {
  return { id: `s.${concept}`, concept, confidence: "explicit", ...extra };
}

function fact(kind: string, value: unknown): ReportedFact {
  return { id: `f.${kind}`, kind, value, confidence: "explicit" };
}

/**
 * Every rule shipped today is `draft`, so these tests opt in explicitly. Production
 * callers must not: see the "unreviewed rules" block below.
 */
function evaluate(
  symptoms: readonly ReportedSymptom[],
  extra: { facts?: readonly ReportedFact[]; ruleSetVersion?: string } = {},
) {
  const { facts = [], ruleSetVersion = RULE_SET } = extra;
  return evaluateSeverity(
    severityEvaluationInputSchema.parse({ symptoms, facts, ruleSetVersion }),
    { executeUnreviewedDraftRules: true },
  );
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [[...items]];
  }
  const out: T[][] = [];
  for (const [index, head] of items.entries()) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) {
      out.push([head, ...tail]);
    }
  }
  return out;
}

const CHEST_PAIN = symptom("chest_pain");
const BREATHLESSNESS = symptom("breathlessness");
const MILD_HEADACHE = symptom("headache", { severity: 2 });
const MEASURED_FEVER = symptom("fever", {
  measurements: [{ name: "temperature_c", value: "40.1", unit: "C" }],
});

/** Spec §8.6: "deterministic same-input/same-rule-version behavior". */
describe("determinism", () => {
  it("returns an identical assessment for repeated evaluation of the same input", () => {
    const symptoms = [CHEST_PAIN, BREATHLESSNESS, MILD_HEADACHE];
    const first = evaluate(symptoms);

    for (let run = 0; run < 50; run += 1) {
      expect(evaluate(symptoms)).toEqual(first);
    }
  });

  it("does not depend on the order symptoms appear in the input", () => {
    const symptoms = [CHEST_PAIN, BREATHLESSNESS, MEASURED_FEVER];
    const expected = evaluate(symptoms);

    for (const permutation of permutations(symptoms)) {
      expect(evaluate(permutation)).toEqual(expected);
    }
  });

  it("emits stably sorted rule ids and explanation keys", () => {
    const assessment = evaluate([CHEST_PAIN, BREATHLESSNESS, MEASURED_FEVER]);

    expect(assessment.ruleIds).toEqual([...assessment.ruleIds].sort());
    expect(assessment.explanationKeys).toEqual([...assessment.explanationKeys].sort());
  });

  it("echoes the rule set version that decided the assessment", () => {
    expect(evaluate([CHEST_PAIN]).ruleSetVersion).toBe(RULE_SET);
  });

  it("pins behaviour to the requested rule set version", () => {
    const registry = new RuleSetRegistry([
      defineRuleSet("test@0.0.1", [
        {
          id: "test.headache",
          version: "0.0.1",
          status: "draft",
          requiredInputs: ["symptom.headache"],
          conditions: [{ kind: "symptom_reported", concept: "headache" }],
          urgencyResult: "monitor",
          patientMessageKey: "severity.explanation.test_headache",
          requiresHumanEscalation: false,
        },
      ]),
    ]);

    const input = severityEvaluationInputSchema.parse({
      symptoms: [MILD_HEADACHE],
      ruleSetVersion: "test@0.0.1",
    });

    expect(
      evaluateSeverity(input, { registry, executeUnreviewedDraftRules: true }).urgency,
    ).toBe("monitor");
    // The same facts under the shipped rule set establish nothing.
    expect(evaluate([MILD_HEADACHE]).urgency).toBe("unknown");
  });

  it("refuses an unpinned or unknown rule set version instead of falling back", () => {
    expect(() => evaluate([CHEST_PAIN], { ruleSetVersion: "red-flags@9.9.9" })).toThrow(
      UnknownRuleSetVersionError,
    );
  });

  it("returns unknown rather than reassurance when no rule fires", () => {
    // Spec §8.3.C: "return `unknown` rather than creating false reassurance".
    const assessment = evaluate([MILD_HEADACHE]);

    expect(assessment.urgency).toBe("unknown");
    expect(assessment.ruleIds).toEqual([]);
    expect(assessment.requiresHumanEscalation).toBe(false);
  });
});

/** Spec §8.6: "red flags cannot be bypassed by conversation ordering". */
describe("red flags cannot be bypassed by conversation ordering", () => {
  it("fires whether the red flag is reported first or last in the conversation", () => {
    const redFlagFirst = evaluate([CHEST_PAIN, BREATHLESSNESS, MILD_HEADACHE]);
    const redFlagLast = evaluate([MILD_HEADACHE, CHEST_PAIN, BREATHLESSNESS]);

    expect(redFlagFirst.urgency).toBe("emergency");
    expect(redFlagLast).toEqual(redFlagFirst);
  });

  it("fires under every ordering of the reported symptoms", () => {
    for (const permutation of permutations([CHEST_PAIN, MILD_HEADACHE, BREATHLESSNESS])) {
      const assessment = evaluate(permutation);

      expect(assessment.urgency).toBe("emergency");
      expect(assessment.ruleIds).toContain("rf.chest_pain_with_breathlessness");
    }
  });

  it("holds the emergency disposition once the red flag facts are present", () => {
    // Simulates a conversation turn by turn: facts accumulate and are re-evaluated.
    const turns = [CHEST_PAIN, BREATHLESSNESS, MILD_HEADACHE, MEASURED_FEVER];
    const accumulated: ReportedSymptom[] = [];
    const urgencies: string[] = [];

    for (const turn of turns) {
      accumulated.push(turn);
      urgencies.push(evaluate(accumulated).urgency);
    }

    expect(urgencies).toEqual(["unknown", "emergency", "emergency", "emergency"]);
  });

  it("does not let a later lower-urgency rule downgrade the disposition", () => {
    const assessment = evaluate([CHEST_PAIN, BREATHLESSNESS, MEASURED_FEVER]);

    // The urgent_today rule also fires and is recorded in the audit trail…
    expect(assessment.ruleIds).toEqual([
      "rf.chest_pain_with_breathlessness",
      "rf.measured_high_fever",
    ]);
    // …but the disposition and the patient-facing keys stay at the emergency level.
    expect(assessment.urgency).toBe("emergency");
    expect(assessment.explanationKeys).toEqual([
      "severity.explanation.chest_pain_with_breathlessness",
    ]);
  });

  it("keeps human escalation once any rule has demanded it", () => {
    const assessment = evaluate([MEASURED_FEVER, CHEST_PAIN, BREATHLESSNESS]);

    expect(assessment.requiresHumanEscalation).toBe(true);
  });

  it("does not read an unmentioned symptom as a denial", () => {
    // Spec §5.2: "Never translate 'not mentioned' into 'denied'."
    const severePain = symptom("abdominal_pain", { severity: 9 });
    const denied = symptom("abdominal_pain", {
      severity: 9,
      deniedSymptoms: ["abdominal_pain"],
    });

    expect(evaluate([severePain]).urgency).toBe("urgent_today");
    expect(evaluate([denied]).urgency).toBe("unknown");
  });
});

/** Facts, not just symptoms, can decide a disposition (spec §5, `KkdSession.facts`). */
describe("fact-based conditions", () => {
  const FEVER = symptom("fever");
  const RECENT_RISK_AREA_TRAVEL = fact("exposure.recent_travel_risk_area", true);

  it("does not fire the travel rule on the symptom alone", () => {
    expect(evaluate([FEVER]).urgency).toBe("unknown");
  });

  it("fires when the symptom and the reported exposure fact are both present", () => {
    const assessment = evaluate([FEVER], { facts: [RECENT_RISK_AREA_TRAVEL] });

    expect(assessment.urgency).toBe("urgent_today");
    expect(assessment.ruleIds).toContain("rf.fever_with_recent_risk_area_travel");
    expect(assessment.explanationKeys).toContain(
      "severity.explanation.fever_with_recent_risk_area_travel",
    );
  });

  it("does not fire when the exposure fact was reported as false", () => {
    const assessment = evaluate([FEVER], {
      facts: [fact("exposure.recent_travel_risk_area", false)],
    });

    expect(assessment.urgency).toBe("unknown");
  });

  it("does not fire on a fact of an unrelated kind", () => {
    expect(
      evaluate([FEVER], { facts: [fact("exposure.recent_contact", true)] }).urgency,
    ).toBe("unknown");
  });

  it("lets a rule fire on facts alone, with no symptoms reported", () => {
    const registry = new RuleSetRegistry([
      defineRuleSet("facts-only@0.0.1", [
        {
          id: "test.fact_only",
          version: "0.0.1",
          status: "active",
          requiredInputs: ["fact.exposure.recent_travel_risk_area"],
          conditions: [
            { kind: "fact_reported", factKind: "exposure.recent_travel_risk_area" },
          ],
          urgencyResult: "soon",
          patientMessageKey: "severity.explanation.test_fact_only",
          requiresHumanEscalation: false,
          reviewedBy: "test-reviewer",
          reviewedAt: "2026-09-02T00:00:00.000Z",
        },
      ]),
    ]);

    const assessment = evaluateSeverity(
      severityEvaluationInputSchema.parse({
        symptoms: [],
        facts: [RECENT_RISK_AREA_TRAVEL],
        ruleSetVersion: "facts-only@0.0.1",
      }),
      { registry },
    );

    expect(assessment.urgency).toBe("soon");
    expect(assessment.ruleIds).toEqual(["test.fact_only"]);
  });

  it("matches a fact value without coercing across types", () => {
    // The string "true" is not the boolean `true`.
    const assessment = evaluate([FEVER], {
      facts: [fact("exposure.recent_travel_risk_area", "true")],
    });

    expect(assessment.urgency).toBe("unknown");
  });
});

/** An unreviewed rule must never decide a patient's urgency by accident (spec §8.3.A). */
describe("unreviewed rules do not run by default", () => {
  const draftInput = severityEvaluationInputSchema.parse({
    symptoms: [CHEST_PAIN, BREATHLESSNESS],
    ruleSetVersion: RULE_SET,
  });

  it("fires no draft rule when the caller does not opt in", () => {
    const assessment = evaluateSeverity(draftInput);

    expect(assessment.urgency).toBe("unknown");
    expect(assessment.ruleIds).toEqual([]);
    expect(assessment.explanationKeys).toEqual([]);
    expect(assessment.requiresHumanEscalation).toBe(false);
  });

  it("fires the same draft rule once the caller opts in explicitly", () => {
    const assessment = evaluateSeverity(draftInput, {
      executeUnreviewedDraftRules: true,
    });

    expect(assessment.urgency).toBe("emergency");
    expect(assessment.ruleIds).toEqual(["rf.chest_pain_with_breathlessness"]);
  });

  it("fires a reviewed active rule without any opt-in", () => {
    const registry = new RuleSetRegistry([
      defineRuleSet("reviewed@0.0.1", [
        {
          id: "test.reviewed",
          version: "0.0.1",
          status: "active",
          requiredInputs: ["symptom.headache"],
          conditions: [{ kind: "symptom_reported", concept: "headache" }],
          urgencyResult: "monitor",
          patientMessageKey: "severity.explanation.test_reviewed",
          requiresHumanEscalation: false,
          reviewedBy: "test-reviewer",
          reviewedAt: "2026-09-02T00:00:00.000Z",
        },
      ]),
    ]);

    const input = severityEvaluationInputSchema.parse({
      symptoms: [MILD_HEADACHE],
      ruleSetVersion: "reviewed@0.0.1",
    });

    expect(evaluateSeverity(input, { registry }).urgency).toBe("monitor");
  });

  it("never runs a retired rule, even when draft execution is opted into", () => {
    const registry = new RuleSetRegistry([
      defineRuleSet("retired@0.0.1", [
        {
          id: "test.retired",
          version: "0.0.1",
          status: "retired",
          requiredInputs: ["symptom.headache"],
          conditions: [{ kind: "symptom_reported", concept: "headache" }],
          urgencyResult: "emergency",
          patientMessageKey: "severity.explanation.test_retired",
          requiresHumanEscalation: false,
        },
      ]),
    ]);

    const input = severityEvaluationInputSchema.parse({
      symptoms: [MILD_HEADACHE],
      ruleSetVersion: "retired@0.0.1",
    });

    expect(
      evaluateSeverity(input, { registry, executeUnreviewedDraftRules: true }).urgency,
    ).toBe("unknown");
  });

  it("defaults DeterministicSafetyEngine to reviewed rules only", () => {
    expect(new DeterministicSafetyEngine().evaluate(draftInput).urgency).toBe("unknown");
    expect(
      new DeterministicSafetyEngine({ executeUnreviewedDraftRules: true }).evaluate(
        draftInput,
      ).urgency,
    ).toBe("emergency");
  });
});
