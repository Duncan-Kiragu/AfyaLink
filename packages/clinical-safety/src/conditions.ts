import type { Measurement, ReportedFact, ReportedSymptom } from "@kkd/contracts";
import type { SafetyRuleCondition, SafetyRuleFactValue } from "./rule-schema.js";

/**
 * The normalized facts a condition is evaluated against (spec §5, `KkdSession`).
 * Symptoms and facts travel together so a rule can read either.
 */
export interface ConditionContext {
  readonly symptoms: readonly ReportedSymptom[];
  readonly facts: readonly ReportedFact[];
}

/**
 * Concepts and measurement names are compared on a normalized form so that rule files
 * are not sensitive to the casing or padding of the extraction layer's output.
 */
export function normalizeConcept(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Measurements arrive as strings with a separate `unit` field (spec §5.1). A value is
 * usable only if the whole string is a finite number; "38-39" or "about 39" are treated
 * as unavailable rather than silently parsed to a number a clinician did not report.
 */
function measurementValue(measurement: Measurement): number | undefined {
  const trimmed = measurement.value.trim();
  if (trimmed === "") {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Usable values of a named measurement across all reported symptoms. Shared with the
 * pathway layer so a rule and a required field agree on what counts as measured.
 */
export function matchingMeasurements(
  symptoms: readonly ReportedSymptom[],
  name: string,
  unit: string | undefined,
): number[] {
  const wanted = normalizeConcept(name);
  const values: number[] = [];
  for (const symptom of symptoms) {
    for (const measurement of symptom.measurements ?? []) {
      if (normalizeConcept(measurement.name) !== wanted) {
        continue;
      }
      // No unit conversion. A rule that pins a unit only matches that unit.
      if (
        unit !== undefined &&
        normalizeConcept(measurement.unit ?? "") !== normalizeConcept(unit)
      ) {
        continue;
      }
      const value = measurementValue(measurement);
      if (value !== undefined) {
        values.push(value);
      }
    }
  }
  return values;
}

/**
 * Compares a `ReportedFact.value` (typed `unknown`) against a rule's literal.
 *
 * Strings are compared on their normalized form; numbers and booleans strictly. No
 * cross-type coercion, so a rule never fires on a value shaped differently from the one
 * the reviewer approved.
 */
function factValueMatches(actual: unknown, expected: SafetyRuleFactValue): boolean {
  if (typeof expected === "string") {
    return (
      typeof actual === "string" &&
      normalizeConcept(actual) === normalizeConcept(expected)
    );
  }
  if (typeof expected === "number") {
    return typeof actual === "number" && actual === expected;
  }
  return typeof actual === "boolean" && actual === expected;
}

function matchingFacts(facts: readonly ReportedFact[], factKind: string): ReportedFact[] {
  const wanted = normalizeConcept(factKind);
  return facts.filter((fact) => normalizeConcept(fact.kind) === wanted);
}

/**
 * Evaluates one condition against normalized facts. Pure and total: an unknown or
 * unparseable input makes a condition false, never throws.
 *
 * All confidence levels count as reported, including `uncertain`. Ignoring uncertain
 * reports would suppress red flags, which spec §8.3.C forbids ("rather than creating
 * false reassurance"). Deliberate and pending clinical review.
 */
export function evaluateCondition(
  condition: SafetyRuleCondition,
  context: ConditionContext,
): boolean {
  const { symptoms, facts } = context;
  switch (condition.kind) {
    case "symptom_reported": {
      const wanted = normalizeConcept(condition.concept);
      return symptoms.some((symptom) => normalizeConcept(symptom.concept) === wanted);
    }
    case "symptom_denied": {
      // Explicitly denied only. Spec §5.2: never read "not mentioned" as "denied".
      const wanted = normalizeConcept(condition.concept);
      return symptoms.some((symptom) =>
        (symptom.deniedSymptoms ?? []).some(
          (denied) => normalizeConcept(denied) === wanted,
        ),
      );
    }
    case "symptom_severity_at_least": {
      const wanted = normalizeConcept(condition.concept);
      return symptoms.some(
        (symptom) =>
          normalizeConcept(symptom.concept) === wanted &&
          symptom.severity !== undefined &&
          symptom.severity >= condition.value,
      );
    }
    case "fact_reported": {
      return matchingFacts(facts, condition.factKind).length > 0;
    }
    case "fact_equals": {
      return matchingFacts(facts, condition.factKind).some((fact) =>
        factValueMatches(fact.value, condition.value),
      );
    }
    case "measurement_at_least": {
      return matchingMeasurements(symptoms, condition.measurement, condition.unit).some(
        (value) => value >= condition.value,
      );
    }
    case "measurement_at_most": {
      return matchingMeasurements(symptoms, condition.measurement, condition.unit).some(
        (value) => value <= condition.value,
      );
    }
    case "all_of": {
      return condition.conditions.every((child) => evaluateCondition(child, context));
    }
    case "any_of": {
      return condition.conditions.some((child) => evaluateCondition(child, context));
    }
    case "none_of": {
      return !condition.conditions.some((child) => evaluateCondition(child, context));
    }
  }
}
