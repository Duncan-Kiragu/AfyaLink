import type { KkdSession, PersistableFact } from "@kkd/contracts";

function pickValueJson(symptom: KkdSession["symptoms"][number]): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  if (symptom.onset) {
    value.onset = symptom.onset;
  }
  if (symptom.duration) {
    value.duration = symptom.duration;
  }
  if (symptom.location) {
    value.location = symptom.location;
  }
  if (typeof symptom.severity === "number") {
    value.severity = symptom.severity;
  }
  if (symptom.character) {
    value.character = symptom.character;
  }
  if (symptom.associatedSymptoms?.length) {
    value.associatedSymptoms = symptom.associatedSymptoms;
  }
  if (symptom.deniedSymptoms?.length) {
    value.deniedSymptoms = symptom.deniedSymptoms;
  }
  if (symptom.measurements?.length) {
    value.measurements = symptom.measurements;
  }
  return value;
}

/**
 * Maps open voice-session symptoms to persistable facts. Skips self-labels so a
 * guessed condition name is never stored as a diagnosis.
 */
export function voiceSessionToPersistableFacts(
  session: KkdSession,
  selectedFactIds: string[],
): PersistableFact[] {
  const selected = new Set(selectedFactIds);
  const facts: PersistableFact[] = [];
  for (const symptom of session.symptoms) {
    if (!selected.has(symptom.id)) {
      continue;
    }
    facts.push({
      entryType: "symptom",
      conceptCode: symptom.concept,
      patientWording: symptom.patientWording,
      valueJson: pickValueJson(symptom),
      effectiveAt: session.lastActivityAt,
      confidence: symptom.confidence,
    });
  }
  return facts;
}
