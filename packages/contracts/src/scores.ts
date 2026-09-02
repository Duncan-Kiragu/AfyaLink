import { z } from "zod";
import { urgencyClassSchema } from "./safety.js";

export const trajectorySchema = z.enum([
  "improving",
  "stable",
  "worsening",
  "insufficient_data",
]);
export type Trajectory = z.infer<typeof trajectorySchema>;

export const systemScoreSnapshotSchema = z.object({
  severityReported: z.number().min(0).max(10).optional(),
  urgencyClass: urgencyClassSchema,
  completenessPercent: z.number().min(0).max(100),
  trajectory: trajectorySchema.optional(),
  algorithmVersion: z.string(),
  generatedAt: z.string(),
});
export type SystemScoreSnapshot = z.infer<typeof systemScoreSnapshotSchema>;
