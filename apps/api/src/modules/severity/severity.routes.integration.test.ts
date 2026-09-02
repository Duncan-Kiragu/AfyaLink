import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { RED_FLAGS_V0_1_0_DRAFT_VERSION } from "@kkd/clinical-safety";
import type * as ClinicalSafety from "@kkd/clinical-safety";
import type { ReportedSymptom } from "@kkd/contracts";
import { createApp } from "../../app.js";

/**
 * Forces the §20 safety-engine-error path. The rest of the suite runs the real
 * evaluator, so the failure branch is exercised without a stubbed engine standing in
 * for the working one.
 */
const engine = vi.hoisted(() => ({ failing: false }));

vi.mock("@kkd/clinical-safety", async (importOriginal) => {
  const actual = await importOriginal<typeof ClinicalSafety>();
  return {
    ...actual,
    evaluateSeverity: (
      ...args: Parameters<typeof actual.evaluateSeverity>
    ): ReturnType<typeof actual.evaluateSeverity> => {
      if (engine.failing) {
        throw new Error("rule set corrupt");
      }
      return actual.evaluateSeverity(...args);
    },
  };
});

const app = createApp();

function symptom(concept: string, extra: Partial<ReportedSymptom> = {}): ReportedSymptom {
  return { id: `sym-${concept}`, concept, confidence: "explicit", ...extra };
}

function evaluate(body: object) {
  return request(app).post("/api/v1/severity/evaluate").send(body);
}

const CHEST_PAIN_WITH_BREATHLESSNESS = {
  symptoms: [symptom("chest_pain", { severity: 8 }), symptom("breathlessness")],
  ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
};

describe("POST /api/v1/severity/evaluate", () => {
  const previousFlag = process.env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES;

  beforeEach(() => {
    process.env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES = "true";
    engine.failing = false;
  });

  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES;
    } else {
      process.env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES = previousFlag;
    }
    engine.failing = false;
  });

  it("returns a real assessment from the rule engine when draft rules are enabled", async () => {
    const response = await evaluate(CHEST_PAIN_WITH_BREATHLESSNESS);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      urgency: "emergency",
      requiresHumanEscalation: true,
      ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
    });
    expect(response.body.ruleIds).toContain("rf.chest_pain_with_breathlessness");
    expect(response.body.explanationKeys).toContain(
      "severity.explanation.chest_pain_with_breathlessness",
    );
    // The disposition came from a rule, so it is not the §20 failure constant.
    expect(response.body.unknownReason).toBeUndefined();
  });

  it("runs no unreviewed rule when the flag is off, and says why it cannot tell", async () => {
    process.env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES = "false";

    const response = await evaluate(CHEST_PAIN_WITH_BREATHLESSNESS);

    expect(response.status).toBe(200);
    expect(response.body.urgency).toBe("unknown");
    expect(response.body.ruleIds).toEqual([]);
    // Not "nothing found": with every rule and pathway gated out, the engine reports
    // that it could not screen anything (spec §8.3.C).
    expect(response.body.unknownReason).toBe("no_pathway_matched");
  });

  it("rejects a body the input schema does not accept", async () => {
    const response = await evaluate({
      symptoms: [{ concept: "chest_pain" }],
      ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
  });

  it("rejects a missing ruleSetVersion rather than picking a rule set", async () => {
    const response = await evaluate({ symptoms: [symptom("chest_pain")] });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
  });

  it("rejects an unknown pinned rule set instead of answering conservatively", async () => {
    const response = await evaluate({
      symptoms: [symptom("chest_pain")],
      ruleSetVersion: "red-flags@9.9.9",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("unknown_rule_set_version");
  });

  it("returns the conservative failure response when the engine throws", async () => {
    engine.failing = true;

    const response = await evaluate(CHEST_PAIN_WITH_BREATHLESSNESS);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      urgency: "urgent_today",
      ruleIds: [],
      explanationKeys: ["severity.failure.seek_professional_care"],
      missingCriticalFacts: [],
      requiresHumanEscalation: true,
      ruleSetVersion: "unavailable",
    });
  });

  it("never answers a failed evaluation with a reassuring disposition", async () => {
    engine.failing = true;

    // The engine-failure path must not resolve to anything a patient could read as
    // "no action needed" (spec §20, §8.3.C).
    const response = await evaluate({
      symptoms: [symptom("headache")],
      ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
    });

    expect(response.status).toBe(200);
    expect(["monitor", "soon", "unknown"]).not.toContain(response.body.urgency);
    expect(response.body.requiresHumanEscalation).toBe(true);
    expect(response.body.ruleSetVersion).toBe("unavailable");
  });
});
