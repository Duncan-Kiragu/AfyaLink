import { describe, expect, it } from "vitest";
import { SYSTEM_SCORE_ALGORITHM_VERSION, systemScoreSnapshotSchema } from "./scores.js";

describe("systemScoreSnapshotSchema", () => {
  const valid = {
    urgencyClass: "soon" as const,
    completenessPercent: 40,
    trajectory: "insufficient_data" as const,
    algorithmVersion: SYSTEM_SCORE_ALGORITHM_VERSION,
    generatedAt: "2026-09-02T12:00:00.000Z",
    explanations: {
      severityReported: "No patient-rated intensity was recorded.",
      urgencyClass: "Urgency class is soon.",
      completenessPercent: "Interview completeness is 40%.",
      trajectory: "Trajectory is insufficient_data.",
    },
  };

  it("accepts a non-diagnostic snapshot", () => {
    expect(systemScoreSnapshotSchema.parse(valid).urgencyClass).toBe("soon");
  });

  it("rejects disease-probability and diagnosis fields", () => {
    expect(() =>
      systemScoreSnapshotSchema.parse({
        ...valid,
        diseaseProbability: 0.81,
      }),
    ).toThrow();
    expect(() =>
      systemScoreSnapshotSchema.parse({
        ...valid,
        diagnosis: "malaria",
      }),
    ).toThrow();
    expect(Object.keys(systemScoreSnapshotSchema.shape)).not.toContain("diseaseProbability");
    expect(Object.keys(systemScoreSnapshotSchema.shape)).not.toEqual(
      expect.arrayContaining(["diagnosis", "differential", "predictedDisease"]),
    );
  });
});
