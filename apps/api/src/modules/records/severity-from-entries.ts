import type {
  FactConfidence,
  RecordEntry,
  ReportedFact,
  ReportedSymptom,
  SeverityEvaluationInput,
} from "@kkd/contracts";
import { RED_FLAGS_V0_1_0_DRAFT_VERSION } from "@kkd/clinical-safety";

function asConfidence(value: unknown): FactConfidence {
  if (value === "clarified" || value === "uncertain" || value === "explicit") {
    return value;
  }
  return "explicit";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}

export function entriesToSeverityInput(entries: RecordEntry[]): SeverityEvaluationInput {
  const symptoms: ReportedSymptom[] = [];
  const facts: ReportedFact[] = [];

  for (const entry of entries) {
    const value = entry.valueJson ?? {};
    if (entry.entryType === "symptom") {
      symptoms.push({
        id: entry.id,
        concept: entry.conceptCode ?? "reported_experience",
        patientWording: entry.patientWording,
        onset: asString(value.onset),
        duration: asString(value.duration),
        location: asString(value.location),
        severity: asNumber(value.severity),
        character: asString(value.character),
        associatedSymptoms: asStringArray(value.associatedSymptoms),
        deniedSymptoms: asStringArray(value.deniedSymptoms),
        confidence: asConfidence(value.confidence),
      });
      continue;
    }
    if (entry.entryType === "note" && entry.patientWording) {
      facts.push({
        id: entry.id,
        kind: asString(value.kind) ?? "patient_statement",
        value: entry.patientWording,
        confidence: asConfidence(value.confidence),
      });
    }
  }

  return {
    symptoms,
    facts,
    priorObservations: [],
    ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
  };
}
