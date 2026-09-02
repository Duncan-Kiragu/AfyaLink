import { describe, expect, it } from "vitest";
import { SYSTEM_SCORE_ALGORITHM_VERSION, type ScoreComputationInput } from "@kkd/contracts";
import {
  completenessPercent,
  computeSystemScore,
  trajectoryFromPoints,
} from "./engine.js";

const base: ScoreComputationInput = {
  urgencyClass: "soon",
  requiredFieldIds: ["primary_experience", "onset_or_duration", "location", "severity"],
  answeredFieldIds: ["primary_experience", "severity"],
  severityReported: 7,
  generatedAt: "2026-09-02T12:00:00.000Z",
};

describe("completenessPercent", () => {
  it("does not increase when fields are only inferred", () => {
    const required = ["a", "b", "c"];
    const withoutInferred = completenessPercent(required, ["a", "b"], ["c"]);
    const inferredCountedWrongly = completenessPercent(required, ["a", "b", "c"], []);
    expect(withoutInferred).toBe(67);
    expect(inferredCountedWrongly).toBe(100);
    expect(completenessPercent(required, ["a", "b", "c"], ["c"])).toBe(67);
  });

  it("is zero when the pathway is empty", () => {
    expect(completenessPercent([], ["a"])).toBe(0);
  });
});

describe("trajectoryFromPoints", () => {
  it("returns insufficient_data without two comparable ratings", () => {
    expect(trajectoryFromPoints([])).toBe("insufficient_data");
    expect(trajectoryFromPoints([{ effectiveAt: "2026-09-01T00:00:00.000Z", severityReported: 6 }])).toBe(
      "insufficient_data",
    );
  });

  it("classifies improving, stable, and worsening from intensity change", () => {
    expect(
      trajectoryFromPoints([
        { effectiveAt: "2026-09-01T00:00:00.000Z", severityReported: 7 },
        { effectiveAt: "2026-09-02T00:00:00.000Z", severityReported: 4 },
      ]),
    ).toBe("improving");
    expect(
      trajectoryFromPoints([
        { effectiveAt: "2026-09-01T00:00:00.000Z", severityReported: 5 },
        { effectiveAt: "2026-09-02T00:00:00.000Z", severityReported: 5 },
      ]),
    ).toBe("stable");
    expect(
      trajectoryFromPoints([
        { effectiveAt: "2026-09-01T00:00:00.000Z", severityReported: 3 },
        { effectiveAt: "2026-09-02T00:00:00.000Z", severityReported: 8 },
      ]),
    ).toBe("worsening");
  });
});

describe("computeSystemScore", () => {
  it("reproduces the same snapshot for the same inputs and algorithm version", () => {
    const first = computeSystemScore(base);
    const second = computeSystemScore(base);
    expect(first).toEqual(second);
    expect(first.algorithmVersion).toBe(SYSTEM_SCORE_ALGORITHM_VERSION);
  });

  it("passes urgency through and never emits disease probability fields", () => {
    const snapshot = computeSystemScore(base);
    expect(snapshot.urgencyClass).toBe("soon");
    expect(snapshot).not.toHaveProperty("diseaseProbability");
    expect(snapshot).not.toHaveProperty("diagnosis");
    expect(JSON.stringify(snapshot)).not.toMatch(/malaria|appendicitis|diagnosis|probability of/i);
    expect(snapshot.explanations.urgencyClass).toContain("safety/severity rules");
  });

  it("rejects an unknown algorithm version instead of silently substituting", () => {
    expect(() =>
      computeSystemScore({
        ...base,
        algorithmVersion: "kkd.system-score.v1",
      }),
    ).not.toThrow();
    expect(() =>
      computeSystemScore({
        ...base,
        // @ts-expect-error proving immutability at the boundary
        algorithmVersion: "kkd.disease-probability.v1",
      }),
    ).toThrow();
  });
});
