import { z } from "zod";
import { urgencyClassSchema } from "./safety.js";

export const SYSTEM_SCORE_ALGORITHM_VERSION = "kkd.system-score.v1";

export const trajectorySchema = z.enum([
  "improving",
  "stable",
  "worsening",
  "insufficient_data",
]);
export type Trajectory = z.infer<typeof trajectorySchema>;

export const scoreExplanationsSchema = z
  .object({
    severityReported: z.string(),
    urgencyClass: z.string(),
    completenessPercent: z.string(),
    trajectory: z.string(),
  })
  .strict();
export type ScoreExplanations = z.infer<typeof scoreExplanationsSchema>;

export const systemScoreSnapshotSchema = z
  .object({
    severityReported: z.number().min(0).max(10).optional(),
    urgencyClass: urgencyClassSchema,
    completenessPercent: z.number().min(0).max(100),
    trajectory: trajectorySchema,
    algorithmVersion: z.string(),
    generatedAt: z.string(),
    explanations: scoreExplanationsSchema,
  })
  .strict();
export type SystemScoreSnapshot = z.infer<typeof systemScoreSnapshotSchema>;

export const storedScoreSnapshotSchema = systemScoreSnapshotSchema.extend({
  id: z.string().uuid(),
  recordId: z.string().uuid(),
});
export type StoredScoreSnapshot = z.infer<typeof storedScoreSnapshotSchema>;

export const comparableScorePointSchema = z
  .object({
    effectiveAt: z.string(),
    severityReported: z.number().min(0).max(10).optional(),
  })
  .strict();
export type ComparableScorePoint = z.infer<typeof comparableScorePointSchema>;

export const scoreComputationInputSchema = z
  .object({
    urgencyClass: urgencyClassSchema,
    requiredFieldIds: z.array(z.string().min(1)).min(1),
    answeredFieldIds: z.array(z.string().min(1)),
    inferredFieldIds: z.array(z.string().min(1)).optional(),
    severityReported: z.number().min(0).max(10).optional(),
    comparablePoints: z.array(comparableScorePointSchema).optional(),
    generatedAt: z.string().optional(),
    algorithmVersion: z.literal(SYSTEM_SCORE_ALGORITHM_VERSION).optional(),
  })
  .strict();
export type ScoreComputationInput = z.infer<typeof scoreComputationInputSchema>;

export const computeScoreInputSchema = z
  .object({
    /** Ignored when present. Urgency is computed by the safety/severity engine. */
    urgencyClass: urgencyClassSchema.optional(),
    requiredFieldIds: z.array(z.string().min(1)).optional(),
    answeredFieldIds: z.array(z.string().min(1)).optional(),
    inferredFieldIds: z.array(z.string().min(1)).optional(),
    severityReported: z.number().min(0).max(10).optional(),
  })
  .strict();
export type ComputeScoreInput = z.infer<typeof computeScoreInputSchema>;

export const scoreListSchema = z.object({
  scores: z.array(storedScoreSnapshotSchema),
});
export type ScoreList = z.infer<typeof scoreListSchema>;

export const scoreSnapshotResponseSchema = z.object({
  score: storedScoreSnapshotSchema,
});
export type ScoreSnapshotResponse = z.infer<typeof scoreSnapshotResponseSchema>;
