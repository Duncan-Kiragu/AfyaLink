import { randomUUID } from "node:crypto";
import { reportedFactSchema, type Measurement, type ReportedFact, type ReportedSymptom } from "@kkd/contracts";

const SELF_DIAGNOSIS = /\b(i have|i think i have|google says i have|nina|nadhani nina)\b/i;

export function isSelfLabelText(text: string): boolean {
  return SELF_DIAGNOSIS.test(text);
}

export function extractSymptom(text: string): ReportedSymptom {
  const severityMatch =
    text.match(/\b([0-9]|10)\s*\/\s*10\b/) ??
    text.match(/\b(?:pain|uchungu)\s*(?:is|=)?\s*([0-9]|10)\b/i);
  const severity = severityMatch?.[1] ? Number.parseInt(severityMatch[1], 10) : undefined;
  const concept = isSelfLabelText(text) ? "unspecified_symptom" : "reported_experience";
  return {
    id: randomUUID(),
    concept,
    patientWording: text,
    onset: /\b(yesterday|jana|hours?|masaa|days?|siku)\b/i.test(text) ? text : undefined,
    duration: /\b(since|tangu|for)\b/i.test(text) ? text : undefined,
    severity,
    confidence: isSelfLabelText(text) ? "uncertain" : "explicit",
  };
}

/**
 * Maps Claude `ReportedFact`s onto existing `ReportedSymptom` fields only.
 * Falls back to the regex stub when nothing usable is present.
 */
export function mapExtractedFactsToSymptoms(
  facts: readonly ReportedFact[],
  patientText: string,
): ReportedSymptom[] {
  const symptom = extractSymptom(patientText);
  const usable = facts.filter((fact) => reportedFactSchema.safeParse(fact).success);
  if (usable.length === 0 || !usable.some(factHasUsableValue)) {
    return [symptom];
  }

  let selfLabel = symptom.concept === "unspecified_symptom";

  for (const fact of usable) {
    const kind = fact.kind.toLowerCase();
    if (looksLikeDiseaseSelfLabel(kind, fact.value)) {
      selfLabel = true;
    }

    if (kind.includes("location")) {
      const value = asFactString(fact.value);
      if (value) {
        symptom.location = value;
      }
      continue;
    }
    if (kind.includes("duration")) {
      const value = asFactString(fact.value);
      if (value) {
        symptom.duration = value;
      }
      continue;
    }
    if (kind.includes("onset") || kind.includes("timeline")) {
      const value = asFactString(fact.value);
      if (value) {
        symptom.onset = value;
      }
      continue;
    }
    if (kind.includes("severity") || kind.includes("intensity") || kind.includes("pain")) {
      const severity = parseSeverity(fact.value);
      if (severity !== undefined) {
        symptom.severity = severity;
      }
      continue;
    }
    if (kind.includes("denied")) {
      const items = asStringList(fact.value);
      if (items.length > 0) {
        symptom.deniedSymptoms = [...(symptom.deniedSymptoms ?? []), ...items];
      }
      continue;
    }
    if (kind.includes("associated")) {
      const items = asStringList(fact.value);
      if (items.length > 0) {
        symptom.associatedSymptoms = [...(symptom.associatedSymptoms ?? []), ...items];
      }
      continue;
    }
    if (kind.includes("measurement")) {
      const measurement = measurementFromFact(fact);
      if (measurement) {
        symptom.measurements = [...(symptom.measurements ?? []), measurement];
      }
    }
  }

  if (selfLabel) {
    symptom.concept = "unspecified_symptom";
    symptom.confidence = "uncertain";
  } else {
    symptom.concept = "reported_experience";
  }
  symptom.patientWording = patientText;
  return [symptom];
}

function factHasUsableValue(fact: ReportedFact): boolean {
  if (asFactString(fact.value) !== undefined) {
    return true;
  }
  if (asStringList(fact.value).length > 0) {
    return true;
  }
  return measurementFromFact(fact) !== undefined;
}

function looksLikeDiseaseSelfLabel(kind: string, value: unknown): boolean {
  if (/self_label|diagnos|disease/.test(kind)) {
    return true;
  }
  const text = asFactString(value);
  return text !== undefined && isSelfLabelText(text);
}

function asFactString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asStringList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function parseSeverity(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return rounded >= 0 && rounded <= 10 ? rounded : undefined;
  }
  const text = asFactString(value);
  if (!text) {
    return undefined;
  }
  const match = text.match(/\b(10|[0-9])\s*\/\s*10\b/) ?? text.match(/\b(10|[0-9])\b/);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return parsed >= 0 && parsed <= 10 ? parsed : undefined;
}

function measurementFromFact(fact: ReportedFact): Measurement | undefined {
  const value = fact.value;
  if (typeof value === "string" || typeof value === "number") {
    const asString = asFactString(value);
    if (!asString) {
      return undefined;
    }
    return { name: fact.kind, value: asString };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const name =
    typeof record.name === "string" && record.name.trim().length > 0 ? record.name.trim() : fact.kind;
  if (typeof record.value === "string" || typeof record.value === "number") {
    const asString = asFactString(record.value);
    if (!asString) {
      return undefined;
    }
    return { name, value: asString };
  }
  return undefined;
}
