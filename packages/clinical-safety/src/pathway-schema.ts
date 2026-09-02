import { z } from "zod";
import { safetyRuleStatusSchema } from "./rule-schema.js";

/**
 * Symptom attributes a pathway can require (spec §5.1, `ReportedSymptom`).
 *
 * Only the scalar attributes. List attributes (`aggravatingFactors`,
 * `associatedSymptoms`, …) are deliberately absent: an empty list is indistinguishable
 * from an unasked question, so requiring one would let silence look like an answer
 * (spec §5.2).
 */
export const symptomAttributeSchema = z.enum([
  "onset",
  "duration",
  "location",
  "movement",
  "severity",
  "character",
]);
export type SymptomAttribute = z.infer<typeof symptomAttributeSchema>;

/**
 * What counts as establishing a required field.
 *
 * Declarative data, like rule conditions, so a reviewer can read a pathway table without
 * reading TypeScript.
 *
 * "Established" means the patient has settled the question either way — reported it,
 * explicitly denied it, or supplied a measurement. It never means "true". Silence leaves
 * a field missing, because spec §5.2 forbids reading "not mentioned" as "denied".
 */
export type RequiredFieldEstablishment =
  /** The concept was reported, or explicitly denied. */
  | { kind: "symptom_presence"; concept: string }
  /** That symptom carries the attribute — or the concept was explicitly denied. */
  | { kind: "symptom_attribute"; concept: string; attribute: SymptomAttribute }
  /** A usable measurement of that name (and unit, when pinned) was supplied. */
  | { kind: "measurement"; measurement: string; unit?: string }
  /** A fact of that kind was reported, whatever its value — `false` establishes it too. */
  | { kind: "fact"; factKind: string }
  /** Any one branch establishes the field. */
  | { kind: "any_of"; establishedBy: RequiredFieldEstablishment[] };

export const requiredFieldEstablishmentSchema: z.ZodType<RequiredFieldEstablishment> =
  z.lazy(() =>
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("symptom_presence"), concept: z.string().min(1) }),
      z.object({
        kind: z.literal("symptom_attribute"),
        concept: z.string().min(1),
        attribute: symptomAttributeSchema,
      }),
      z.object({
        kind: z.literal("measurement"),
        measurement: z.string().min(1),
        unit: z.string().optional(),
      }),
      z.object({ kind: z.literal("fact"), factKind: z.string().min(1) }),
      z.object({
        kind: z.literal("any_of"),
        establishedBy: z.array(requiredFieldEstablishmentSchema).min(1),
      }),
    ]),
  );

/**
 * One field a pathway must establish before its disposition is trustworthy
 * (spec §8.3.B step 4).
 *
 * `id` uses the same vocabulary as a rule's `requiredInputs`, so a rule and a pathway
 * name the same fact the same way and the two tables can be cross-checked:
 * `symptom.<concept>`, `symptom.<concept>.<attribute>`, `measurement.<name>`,
 * `fact.<kind>`.
 */
export const REQUIRED_FIELD_ID_PATTERN = /^(symptom|measurement|fact)\.[a-z0-9_.]+$/;

export const requiredFieldSchema = z.object({
  id: z.string().regex(REQUIRED_FIELD_ID_PATTERN),
  /**
   * Ask order (spec §8.3.B step 5: "ask those questions before lower-value detail
   * questions"). Lower is asked first; ties break on `id` so output is deterministic.
   * By convention: 10 = red-flag discriminator, 20 = pathway-critical, 30+ = detail.
   */
  priority: z.number().int().min(0),
  establishedBy: requiredFieldEstablishmentSchema,
  /**
   * i18n key for the question that establishes this field. Key only: no patient-facing
   * wording lives in this repo until a clinical reviewer exists (spec §8.3.D).
   */
  questionKey: z.string().min(1),
  /** Internal review note. Must never name a disease (product constitution §1.1). */
  rationale: z.string().optional(),
});
export type RequiredField = z.infer<typeof requiredFieldSchema>;

/**
 * A complaint pathway: for a presenting complaint, the facts that must be established
 * before any disposition — including a reassuring one — is trustworthy (spec §8.3.B
 * step 4).
 *
 * Pathways carry the same review lifecycle as rules, because a completed pathway is what
 * licenses §8.3.D's "no urgent warning sign has been identified" wording. An incomplete
 * or unreviewed table would make that sentence a guess.
 */
export const complaintPathwaySchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    status: safetyRuleStatusSchema,
    /**
     * Reported symptom concepts that activate this pathway. Matched against every
     * reported concept, not just a "chief complaint": the patient may mention the
     * pathway-defining symptom at any point in the conversation (spec §8.3.B).
     */
    presentingConcepts: z.array(z.string().min(1)).min(1),
    requiredFields: z.array(requiredFieldSchema).min(1),
    clinicalRationale: z.string().optional(),
    sourceMetadata: z.string().optional(),
    reviewedBy: z.string().optional(),
    reviewedAt: z.string().optional(),
  })
  .superRefine((pathway, ctx) => {
    const seen = new Set<string>();
    for (const [index, field] of pathway.requiredFields.entries()) {
      if (seen.has(field.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["requiredFields", index, "id"],
          message: `Duplicate required field id "${field.id}" in pathway ${pathway.id}`,
        });
      }
      seen.add(field.id);
    }
    if (pathway.status !== "active") {
      return;
    }
    for (const key of ["reviewedBy", "reviewedAt"] as const) {
      if (!pathway[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when a complaint pathway has status "active"`,
        });
      }
    }
  });
export type ComplaintPathway = z.infer<typeof complaintPathwaySchema>;
