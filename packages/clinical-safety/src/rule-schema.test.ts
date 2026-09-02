import { describe, expect, it } from "vitest";
import { safetyRuleSchema } from "./rule-schema.js";

const baseRule = {
  id: "rf.example",
  version: "0.1.0",
  status: "draft",
  requiredInputs: ["symptom.example"],
  conditions: [{ kind: "symptom_reported", concept: "example" }],
  urgencyResult: "emergency",
  patientMessageKey: "severity.explanation.example",
};

describe("safetyRuleSchema", () => {
  it("accepts a draft rule without review metadata", () => {
    const parsed = safetyRuleSchema.parse(baseRule);

    expect(parsed.status).toBe("draft");
    expect(parsed.requiresHumanEscalation).toBe(false);
  });

  it("rejects an active rule that has not been clinically reviewed", () => {
    // Spec §8.3.A requires reviewed_by / reviewed_at on a rule.
    const result = safetyRuleSchema.safeParse({ ...baseRule, status: "active" });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "reviewedBy",
      "reviewedAt",
    ]);
  });

  it("accepts an active rule once it carries a reviewer and a review date", () => {
    const result = safetyRuleSchema.safeParse({
      ...baseRule,
      status: "active",
      reviewedBy: "example-reviewer",
      reviewedAt: "2026-09-02T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an urgency result that is not in the agreed disposition enum", () => {
    // Spec §8.2 — the enum is the only vocabulary; no disease-shaped outputs.
    expect(
      safetyRuleSchema.safeParse({ ...baseRule, urgencyResult: "probably_fine" }).success,
    ).toBe(false);
  });

  it("requires at least one condition", () => {
    expect(safetyRuleSchema.safeParse({ ...baseRule, conditions: [] }).success).toBe(
      false,
    );
  });

  it("validates nested condition combinators", () => {
    const parsed = safetyRuleSchema.parse({
      ...baseRule,
      conditions: [
        {
          kind: "any_of",
          conditions: [
            { kind: "symptom_reported", concept: "a" },
            { kind: "none_of", conditions: [{ kind: "symptom_denied", concept: "b" }] },
          ],
        },
      ],
    });

    expect(parsed.conditions).toHaveLength(1);
  });
});
