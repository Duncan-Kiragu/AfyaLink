import { z } from "zod";

export const urgencyClassSchema = z.enum([
  "emergency",
  "urgent_today",
  "soon",
  "monitor",
  "unknown",
]);
export type UrgencyClass = z.infer<typeof urgencyClassSchema>;

export const safetyAssessmentSchema = z.object({
  urgency: urgencyClassSchema,
  ruleIds: z.array(z.string()),
  explanationKeys: z.array(z.string()),
  missingCriticalFacts: z.array(z.string()),
  requiresHumanEscalation: z.boolean(),
  ruleSetVersion: z.string(),
});
export type SafetyAssessment = z.infer<typeof safetyAssessmentSchema>;

export const assessmentCompletenessSchema = z.object({
  percent: z.number().min(0).max(100),
  missingFieldIds: z.array(z.string()),
});
export type AssessmentCompleteness = z.infer<typeof assessmentCompletenessSchema>;
