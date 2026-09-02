import { z } from "zod";
import { reportedFactSchema, reportedSymptomSchema } from "./symptoms.js";

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

/**
 * Input to the severity/urgency engine (spec §8.2, §8.3).
 *
 * The engine is pure: normalized facts in, `SafetyAssessment` out. It performs no
 * Redis, Supabase, or network access and never receives a session object, so the
 * same input plus the same `ruleSetVersion` always yields the same assessment
 * (spec §8.6, "deterministic same-input/same-rule-version behavior").
 *
 * Check-ins re-run the same engine (spec §8.4.E) and have no session, which is why
 * this contract is expressed in facts rather than in `KkdSession`.
 */
export const priorObservationSchema = z.object({
  /** ISO-8601 instant the observation was reported. */
  observedAt: z.string(),
  symptoms: z.array(reportedSymptomSchema),
  facts: z.array(reportedFactSchema).default([]),
  /** Urgency recorded at that observation, where one was computed. */
  urgency: urgencyClassSchema.optional(),
});
export type PriorObservation = z.infer<typeof priorObservationSchema>;

export const severityEvaluationInputSchema = z.object({
  symptoms: z.array(reportedSymptomSchema),
  facts: z.array(reportedFactSchema).default([]),
  /**
   * Earlier check-ins, oldest first. Passed in explicitly rather than looked up,
   * so longitudinal rules (spec §8.6, "worsening follow-up can trigger a higher
   * urgency") stay deterministic and the engine stays free of I/O.
   */
  priorObservations: z.array(priorObservationSchema).default([]),
  /**
   * ISO-8601 instant to evaluate against. Reserved for time-dependent rules so they
   * read a supplied clock value rather than the system clock. Rules that need it
   * declare it in `requiredInputs`.
   */
  evaluatedAt: z.string().optional(),
  /** Pinned rule set. The engine resolves this exact version or throws. */
  ruleSetVersion: z.string(),
});
export type SeverityEvaluationInput = z.infer<typeof severityEvaluationInputSchema>;
