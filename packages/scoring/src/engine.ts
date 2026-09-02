import {
  SYSTEM_SCORE_ALGORITHM_VERSION,
  scoreComputationInputSchema,
  systemScoreSnapshotSchema,
  type ScoreComputationInput,
  type ScoreExplanations,
  type SystemScoreSnapshot,
  type Trajectory,
} from "@kkd/contracts";

export { SYSTEM_SCORE_ALGORITHM_VERSION };

export const DEFAULT_COMPLETENESS_FIELD_IDS = [
  "primary_experience",
  "onset_or_duration",
  "location",
  "severity",
  "associated_or_denied",
] as const;

const DIAGNOSTIC_CLAIM = /\b(you may have|you have|this sounds like|possible diagnosis|differential diagnosis|predicted condition is)\b/i;

export function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.length > 0))];
}

export function completenessPercent(
  requiredFieldIds: string[],
  answeredFieldIds: string[],
  inferredFieldIds: string[] = [],
): number {
  const required = uniqueIds(requiredFieldIds);
  if (required.length === 0) {
    return 0;
  }
  const inferred = new Set(uniqueIds(inferredFieldIds));
  const answered = uniqueIds(answeredFieldIds).filter(
    (id) => required.includes(id) && !inferred.has(id),
  );
  return Math.min(100, Math.round((answered.length / required.length) * 100));
}

export function trajectoryFromPoints(
  points: Array<{ effectiveAt: string; severityReported?: number }>,
): Trajectory {
  const comparable = points
    .filter((point) => typeof point.severityReported === "number")
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
  if (comparable.length < 2) {
    return "insufficient_data";
  }
  const first = comparable[0]?.severityReported;
  const last = comparable[comparable.length - 1]?.severityReported;
  if (typeof first !== "number" || typeof last !== "number") {
    return "insufficient_data";
  }
  const delta = last - first;
  if (delta <= -1) {
    return "improving";
  }
  if (delta >= 1) {
    return "worsening";
  }
  return "stable";
}

function explanations(input: {
  severityReported?: number;
  urgencyClass: ScoreComputationInput["urgencyClass"];
  completenessPercent: number;
  trajectory: Trajectory;
}): ScoreExplanations {
  return {
    severityReported:
      input.severityReported === undefined
        ? "No patient-rated intensity (0–10) was recorded. This number is never a condition label."
        : `The patient rated reported intensity as ${input.severityReported}/10. This is the patient’s own rating, not a predicted condition.`,
    urgencyClass: `Urgency class is ${input.urgencyClass}. It is passed through from the safety/severity rules. It names a care-timing class only.`,
    completenessPercent: `Interview completeness is ${input.completenessPercent}%. It counts required pathway fields the patient actually answered. Inferred fields do not increase this number.`,
    trajectory:
      input.trajectory === "insufficient_data"
        ? "Trajectory is insufficient_data because fewer than two comparable patient-rated intensity values exist."
        : `Trajectory is ${input.trajectory} based on change in comparable patient-rated intensity over time, not a predicted condition.`,
  };
}

export function assertNonDiagnosticScore(snapshot: SystemScoreSnapshot): void {
  const forbiddenKeys = ["diseaseProbability", "diagnosis", "differential", "predictedDisease"];
  for (const key of forbiddenKeys) {
    if (key in snapshot) {
      throw new Error("diagnostic_score_forbidden");
    }
  }
  if (DIAGNOSTIC_CLAIM.test(JSON.stringify(snapshot))) {
    throw new Error("diagnostic_score_forbidden");
  }
}

export function computeSystemScore(input: ScoreComputationInput): SystemScoreSnapshot {
  const parsed = scoreComputationInputSchema.parse(input);
  if (parsed.algorithmVersion && parsed.algorithmVersion !== SYSTEM_SCORE_ALGORITHM_VERSION) {
    throw Object.assign(new Error("unknown_score_algorithm_version"), { statusCode: 400 });
  }
  const percent = completenessPercent(
    parsed.requiredFieldIds,
    parsed.answeredFieldIds,
    parsed.inferredFieldIds,
  );
  const trajectory = trajectoryFromPoints(parsed.comparablePoints ?? []);
  const snapshot = systemScoreSnapshotSchema.parse({
    severityReported: parsed.severityReported,
    urgencyClass: parsed.urgencyClass,
    completenessPercent: percent,
    trajectory,
    algorithmVersion: SYSTEM_SCORE_ALGORITHM_VERSION,
    generatedAt: parsed.generatedAt ?? new Date().toISOString(),
    explanations: explanations({
      severityReported: parsed.severityReported,
      urgencyClass: parsed.urgencyClass,
      completenessPercent: percent,
      trajectory,
    }),
  });
  assertNonDiagnosticScore(snapshot);
  return snapshot;
}

export interface ScoreEngine {
  snapshot(input: ScoreComputationInput): SystemScoreSnapshot;
}

export class SystemScoreEngine implements ScoreEngine {
  snapshot(input: ScoreComputationInput): SystemScoreSnapshot {
    return computeSystemScore(input);
  }
}
