import type { ReportedSymptom } from "@kkd/contracts";
import {
  matchingMeasurements,
  normalizeConcept,
  type ConditionContext,
} from "./conditions.js";
import type {
  ComplaintPathway,
  RequiredField,
  RequiredFieldEstablishment,
} from "./pathway-schema.js";

/**
 * A required field the input does not establish, with the question that would establish
 * it. `SafetyAssessment.missingCriticalFacts` carries the `fieldId`s of these, in this
 * order; the rest is what a caller needs to actually ask (spec §8.3.B step 5).
 */
export interface MissingCriticalField {
  readonly fieldId: string;
  readonly questionKey: string;
  readonly priority: number;
  /** Pathways that require this field, sorted. One field can serve several. */
  readonly pathwayIds: readonly string[];
}

function isConceptReported(
  symptoms: readonly ReportedSymptom[],
  concept: string,
): boolean {
  const wanted = normalizeConcept(concept);
  return symptoms.some((symptom) => normalizeConcept(symptom.concept) === wanted);
}

function isConceptDenied(symptoms: readonly ReportedSymptom[], concept: string): boolean {
  const wanted = normalizeConcept(concept);
  return symptoms.some((symptom) =>
    (symptom.deniedSymptoms ?? []).some((denied) => normalizeConcept(denied) === wanted),
  );
}

/**
 * Whether the input settles a required field, either way.
 *
 * Pure and total. Every confidence level counts, `uncertain` included: spec §5.2 lists
 * `uncertain` ("patient was unsure") and `unknown` ("not established") as different
 * things, so an unsure answer is an answer and re-asking it would loop. This is a
 * different test from §6.5's completeness rule, which counts only explicit and
 * clarified facts — see `docs/adr/ws4-plan.md` §5, issue I.
 *
 * Nothing here reads absence as a negative finding. Silence establishes nothing.
 */
export function isFieldEstablished(
  establishedBy: RequiredFieldEstablishment,
  context: ConditionContext,
): boolean {
  const { symptoms, facts } = context;
  switch (establishedBy.kind) {
    case "symptom_presence": {
      // Reported or explicitly denied. Spec §5.2: silence is neither.
      return (
        isConceptReported(symptoms, establishedBy.concept) ||
        isConceptDenied(symptoms, establishedBy.concept)
      );
    }
    case "symptom_attribute": {
      // A denied concept has no attributes left worth asking about.
      if (isConceptDenied(symptoms, establishedBy.concept)) {
        return true;
      }
      const wanted = normalizeConcept(establishedBy.concept);
      return symptoms.some(
        (symptom) =>
          normalizeConcept(symptom.concept) === wanted &&
          symptom[establishedBy.attribute] !== undefined,
      );
    }
    case "measurement": {
      return (
        matchingMeasurements(symptoms, establishedBy.measurement, establishedBy.unit)
          .length > 0
      );
    }
    case "fact": {
      // Any value establishes it, `false` included: the patient answered the question.
      const wanted = normalizeConcept(establishedBy.factKind);
      return facts.some((fact) => normalizeConcept(fact.kind) === wanted);
    }
    case "any_of": {
      return establishedBy.establishedBy.some((child) =>
        isFieldEstablished(child, context),
      );
    }
  }
}

/**
 * Pathways activated by what the patient has reported (spec §8.3.B step 4, "the current
 * complaint pathway").
 *
 * A pathway activates when any reported concept is one of its `presentingConcepts`.
 * Several can activate at once — a patient with fever and abdominal pain is on both
 * pathways — and the union of their required fields is what must be established. A
 * denied concept does not activate a pathway.
 *
 * Returned sorted by id, so nothing downstream depends on rule-set file order.
 */
export function activePathways(
  pathways: readonly ComplaintPathway[],
  context: ConditionContext,
): readonly ComplaintPathway[] {
  const activated = pathways.filter((pathway) =>
    pathway.presentingConcepts.some((concept) =>
      isConceptReported(context.symptoms, concept),
    ),
  );
  return activated.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Required fields of the given pathways that the input does not establish, in the order
 * they should be asked: critical discriminators before lower-value detail
 * (spec §8.3.B step 5).
 *
 * Ordering is `priority` ascending, ties broken on `fieldId`, so the caller can take the
 * first entry and the output is stable for the same input (spec §8.6).
 *
 * A field required by more than one active pathway appears once, at its most urgent
 * declared priority.
 */
export function missingCriticalFields(
  pathways: readonly ComplaintPathway[],
  context: ConditionContext,
): readonly MissingCriticalField[] {
  const byFieldId = new Map<string, { field: RequiredField; pathwayIds: Set<string> }>();

  for (const pathway of pathways) {
    for (const field of pathway.requiredFields) {
      if (isFieldEstablished(field.establishedBy, context)) {
        continue;
      }
      const existing = byFieldId.get(field.id);
      if (!existing) {
        byFieldId.set(field.id, { field, pathwayIds: new Set([pathway.id]) });
        continue;
      }
      existing.pathwayIds.add(pathway.id);
      if (field.priority < existing.field.priority) {
        existing.field = field;
      }
    }
  }

  return [...byFieldId.values()]
    .map(({ field, pathwayIds }) => ({
      fieldId: field.id,
      questionKey: field.questionKey,
      priority: field.priority,
      pathwayIds: [...pathwayIds].sort(),
    }))
    .sort(
      (left, right) =>
        left.priority - right.priority || left.fieldId.localeCompare(right.fieldId),
    );
}
