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

/**
 * Why an assessment came back `unknown` (spec §8.3.C).
 *
 * §8.2 fixes `UrgencyClass` to five values and Duncan's `SystemScoreSnapshot` (§6.3.D)
 * consumes that enum, so the distinction cannot be a sixth urgency class. It is carried
 * alongside instead: `unknown` on its own conflates two very different situations, and
 * §8.3.C forbids the second one reading as reassurance.
 *
 * - `missing_critical_facts` — a complaint pathway is active and required fields for it
 *   are still unestablished. `missingCriticalFacts` lists them in ask-first order. The
 *   engine cannot tell yet. Never present this as "nothing found".
 * - `no_pathway_matched` — no complaint pathway covers what was reported, so the engine
 *   cannot even enumerate what it would need. Also not a negative finding.
 * - `screened_no_rule_matched` — every required field of every active pathway is
 *   established and no rule fired. This is the only `unknown` that supports §8.3.D's
 *   "No urgent warning sign has been identified from the information collected so far".
 */
export const unknownReasonSchema = z.enum([
  "missing_critical_facts",
  "no_pathway_matched",
  "screened_no_rule_matched",
]);
export type UnknownReason = z.infer<typeof unknownReasonSchema>;

export const safetyAssessmentSchema = z
  .object({
    urgency: urgencyClassSchema,
    ruleIds: z.array(z.string()),
    explanationKeys: z.array(z.string()),
    /**
     * Required fields for the active complaint pathway that the input does not
     * establish, in the order they should be asked (spec §8.3.B steps 4-5).
     *
     * Spec §5.2: silence is not denial. A field is missing until the patient reports it,
     * explicitly denies it, or supplies a measurement. Populated at every urgency, not
     * only at `unknown` — but §8.3.B step 3 requires the approved safety message before
     * further questioning once a critical threshold is met.
     */
    missingCriticalFacts: z.array(z.string()),
    requiresHumanEscalation: z.boolean(),
    ruleSetVersion: z.string(),
    /**
     * Set by the engine whenever `urgency` is `unknown`, and only then.
     *
     * An assessment with `urgency: "unknown"` and no `unknownReason` did not come from
     * the engine — for example a session's pre-evaluation zero state (§5's
     * `KkdSession.safety` is non-optional). Treat that as "not evaluated"; it is never
     * evidence that nothing was found.
     */
    unknownReason: unknownReasonSchema.optional(),
  })
  .superRefine((assessment, ctx) => {
    if (assessment.unknownReason !== undefined && assessment.urgency !== "unknown") {
      ctx.addIssue({
        code: "custom",
        path: ["unknownReason"],
        message: 'unknownReason is only meaningful when urgency is "unknown"',
      });
    }
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
