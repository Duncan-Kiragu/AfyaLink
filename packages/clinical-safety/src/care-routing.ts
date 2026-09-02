import { type CareCategory, type UrgencyClass } from "@kkd/contracts";
import { type ReportedSymptom } from "@kkd/contracts";

export interface CareRoutingInput {
  urgency: UrgencyClass;
  reportedSymptoms: ReportedSymptom[];
  patientAge?: number;
}

/**
 * Deterministically map urgency + reported symptoms to care category.
 * No disease inference. Symptom-based routing only.
 */
export function routeToCareCategory(input: CareRoutingInput): CareCategory {
  // Emergency always takes priority
  if (input.urgency === "emergency") {
    return "emergency_department";
  }

  // Extract symptom concepts and check for patterns
  const symptoms = input.reportedSymptoms.map((s) => s.concept.toLowerCase());
  const patientWording = input.reportedSymptoms
    .map((s) => (s.patientWording || "").toLowerCase())
    .join(" ");

  // Obstetric/pregnancy routing
  if (
    symptoms.some((s) => s.includes("pregnancy")) ||
    symptoms.some((s) => s.includes("obstetric")) ||
    patientWording.includes("pregnant") ||
    patientWording.includes("pregnancy")
  ) {
    return "obstetric_care";
  }

  // Eye care routing
  if (symptoms.some((s) => s.includes("eye")) || patientWording.includes("eye")) {
    return "eye_care";
  }

  // Dental care routing
  if (
    symptoms.some((s) => s.includes("dental")) ||
    symptoms.some((s) => s.includes("tooth")) ||
    patientWording.includes("dental") ||
    patientWording.includes("tooth")
  ) {
    return "dental_care";
  }

  // Mental health routing
  if (
    symptoms.some((s) => s.includes("mental") || s.includes("depression")) ||
    symptoms.some((s) => s.includes("anxiety")) ||
    patientWording.includes("mental health") ||
    patientWording.includes("depression") ||
    patientWording.includes("anxiety")
  ) {
    return "mental_health";
  }

  // Pediatric routing
  if (input.patientAge !== undefined && input.patientAge < 5) {
    return "paediatrics";
  }

  // Laboratory (if symptoms indicate need for tests)
  if (
    symptoms.some((s) => s.includes("test") || s.includes("blood")) ||
    patientWording.includes("lab")
  ) {
    return "laboratory";
  }

  // Pharmacy (if only medication-related)
  if (
    symptoms.every((s) => s.includes("medication") || s.includes("prescription")) &&
    symptoms.length > 0
  ) {
    return "pharmacy";
  }

  // Default to primary care
  return "primary_care";
}
