import { urgencyClassSchema } from "@kkd/contracts";
import { z } from "zod";

/**
 * Rule lifecycle (spec §8.3.A, "status").
 *
 * `active` requires a named clinical reviewer. KKD has no assigned clinical reviewer
 * yet (spec §3 names none, while §8.2/§8.3.A/§8.3.B/§8.3.D all require review), so
 * every shipped rule is currently `draft`.
 */
export const safetyRuleStatusSchema = z.enum(["draft", "active", "retired"]);
export type SafetyRuleStatus = z.infer<typeof safetyRuleStatusSchema>;

/**
 * Statuses the evaluator executes. `retired` rules are never run.
 *
 * Draft rules execute so the engine is testable before clinical sign-off. Gating
 * draft rules out of production is a deployment concern, not an engine concern.
 */
export const EXECUTABLE_RULE_STATUSES: readonly SafetyRuleStatus[] = ["draft", "active"];

/**
 * Declarative condition language (spec §8.3.A, "conditions").
 *
 * Conditions are data, not functions, so a rule file can be reviewed, diffed, and
 * version-pinned by a clinician without reading TypeScript.
 *
 * There is deliberately no "symptom not mentioned" condition. Spec §5.2: "Never
 * translate 'not mentioned' into 'denied'." Absence of information is handled by
 * `requiredInputs` and reported as a missing critical fact, never as a negative.
 */
export type SafetyRuleCondition =
  /** The concept appears in the reported symptoms. */
  | { kind: "symptom_reported"; concept: string }
  /** The concept appears in a `deniedSymptoms` list, i.e. the patient explicitly denied it. */
  | { kind: "symptom_denied"; concept: string }
  | { kind: "symptom_severity_at_least"; concept: string; value: number }
  | { kind: "measurement_at_least"; measurement: string; value: number; unit?: string }
  | { kind: "measurement_at_most"; measurement: string; value: number; unit?: string }
  | { kind: "all_of"; conditions: SafetyRuleCondition[] }
  | { kind: "any_of"; conditions: SafetyRuleCondition[] }
  | { kind: "none_of"; conditions: SafetyRuleCondition[] };

export const safetyRuleConditionSchema: z.ZodType<SafetyRuleCondition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("symptom_reported"), concept: z.string().min(1) }),
    z.object({ kind: z.literal("symptom_denied"), concept: z.string().min(1) }),
    z.object({
      kind: z.literal("symptom_severity_at_least"),
      concept: z.string().min(1),
      value: z.number().min(0).max(10),
    }),
    z.object({
      kind: z.literal("measurement_at_least"),
      measurement: z.string().min(1),
      value: z.number(),
      unit: z.string().optional(),
    }),
    z.object({
      kind: z.literal("measurement_at_most"),
      measurement: z.string().min(1),
      value: z.number(),
      unit: z.string().optional(),
    }),
    z.object({
      kind: z.literal("all_of"),
      conditions: z.array(safetyRuleConditionSchema).min(1),
    }),
    z.object({
      kind: z.literal("any_of"),
      conditions: z.array(safetyRuleConditionSchema).min(1),
    }),
    z.object({
      kind: z.literal("none_of"),
      conditions: z.array(safetyRuleConditionSchema).min(1),
    }),
  ]),
);

/**
 * A versioned safety rule (spec §8.3.A).
 *
 * Spec §8.3.A: "Do not let Claude directly return the final urgency class without
 * the rule engine checking/deciding it." `urgencyResult` is therefore the only path
 * to an urgency class.
 */
export const safetyRuleSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    status: safetyRuleStatusSchema,
    /**
     * Facts the rule needs before it can be decided. Consumed by the missing-critical-fact
     * pathway, which is Slice 3; the evaluator does not read this field yet.
     */
    requiredInputs: z.array(z.string()),
    /** ANDed together. Use `any_of` / `none_of` for anything richer. */
    conditions: z.array(safetyRuleConditionSchema).min(1),
    urgencyResult: urgencyClassSchema,
    /**
     * i18n key only. No patient-facing wording lives in this repo until a clinical
     * reviewer exists (spec §8.3.D, "All exact wording requires clinical review").
     */
    patientMessageKey: z.string().min(1),
    /**
     * Whether firing this rule requires handoff to a human (spec §8.2,
     * `requiresHumanEscalation`). The spec never defines the trigger, so it is declared
     * per rule rather than inferred by the engine, pending a team decision.
     */
    requiresHumanEscalation: z.boolean().default(false),
    /** Internal review metadata. Must never name a disease (product constitution §1.1). */
    clinicalRationale: z.string().optional(),
    sourceMetadata: z.string().optional(),
    reviewedBy: z.string().optional(),
    reviewedAt: z.string().optional(),
  })
  .superRefine((rule, ctx) => {
    if (rule.status !== "active") {
      return;
    }
    for (const key of ["reviewedBy", "reviewedAt"] as const) {
      if (!rule[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when a safety rule has status "active"`,
        });
      }
    }
  });
export type SafetyRule = z.infer<typeof safetyRuleSchema>;
