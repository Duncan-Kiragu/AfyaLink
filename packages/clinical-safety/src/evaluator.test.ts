import { severityEvaluationInputSchema, type ReportedSymptom } from "@kkd/contracts";
import { describe, expect, it } from "vitest";
import { evaluateSeverity } from "./evaluator.js";
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

function evaluate(symptoms: readonly ReportedSymptom[], ruleSetVersion = RULE_SET) {
  return evaluateSeverity(
    severityEvaluationInputSchema.parse({ symptoms, ruleSetVersion }),
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

    expect(evaluateSeverity(input, registry).urgency).toBe("monitor");
    // The same facts under the shipped rule set establish nothing.
    expect(evaluate([MILD_HEADACHE]).urgency).toBe("unknown");
  });

  it("refuses an unpinned or unknown rule set version instead of falling back", () => {
    expect(() => evaluate([CHEST_PAIN], "red-flags@9.9.9")).toThrow(
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
