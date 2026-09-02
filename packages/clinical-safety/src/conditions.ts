import type { Measurement, ReportedSymptom } from "@kkd/contracts";
import type { SafetyRuleCondition } from "./rule-schema.js";

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

function matchingMeasurements(
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
 * Evaluates one condition against normalized facts. Pure and total: an unknown or
 * unparseable input makes a condition false, never throws.
 *
 * All confidence levels count as reported, including `uncertain`. Ignoring uncertain
 * reports would suppress red flags, which spec §8.3.C forbids ("rather than creating
 * false reassurance"). Deliberate and pending clinical review.
 */
export function evaluateCondition(
  condition: SafetyRuleCondition,
  symptoms: readonly ReportedSymptom[],
): boolean {
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
      return condition.conditions.every((child) => evaluateCondition(child, symptoms));
    }
    case "any_of": {
      return condition.conditions.some((child) => evaluateCondition(child, symptoms));
    }
    case "none_of": {
      return !condition.conditions.some((child) => evaluateCondition(child, symptoms));
    }
  }
}
