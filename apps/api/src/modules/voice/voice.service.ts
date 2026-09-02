import { randomUUID } from "node:crypto";
import type { ConsultationSummary, KkdSession, ReportedFact, ReportedSymptom } from "@kkd/contracts";
import { stripDiagnosticLanguage } from "./diagnosis-guard.js";
import { evaluateVoiceSafety } from "./voice-safety.stub.js";
import {
  deleteVoiceSession,
  getVoiceSession,
  saveVoiceSession,
  type VoiceSessionRecord,
} from "./voice.store.js";

export const DISCLOSURE_VERSION = "voice.v1";

const SELF_DIAGNOSIS = /\b(i have|i think i have|google says i have|nina|nadhani nina)\b/i;

export function createVoiceSession(locale: string): VoiceSessionRecord {
  const now = new Date().toISOString();
  const session: KkdSession = {
    id: randomUUID(),
    mode: "anonymous_ephemeral",
    channel: "voice",
    locale,
    createdAt: now,
    lastActivityAt: now,
    disclosureVersion: DISCLOSURE_VERSION,
    facts: [],
    symptoms: [],
    safety: evaluateVoiceSafetyPlaceholder(),
    completion: { percent: 0, missingFieldIds: ["primary_experience", "onset_or_duration", "severity"] },
  };
  const record: VoiceSessionRecord = {
    session,
    disclosureAcknowledged: false,
    closed: false,
    mockCallStatus: "idle",
    callbackStatus: "none",
  };
  record.session.safety = evaluateVoiceSafety(record);
  saveVoiceSession(record);
  return record;
}

function evaluateVoiceSafetyPlaceholder() {
  return {
    urgency: "unknown" as const,
    ruleIds: [],
    explanationKeys: [],
    missingCriticalFacts: ["primary_experience"],
    requiresHumanEscalation: false,
    ruleSetVersion: "voice-stub.v0",
  };
}

export function requireOpenSession(sessionId: string): VoiceSessionRecord {
  const record = getVoiceSession(sessionId);
  if (!record || record.closed) {
    throw Object.assign(new Error("voice_session_not_found"), { statusCode: 404 });
  }
  return record;
}

export function acknowledgeDisclosure(sessionId: string, version: string): VoiceSessionRecord {
  const record = requireOpenSession(sessionId);
  if (version !== DISCLOSURE_VERSION) {
    throw Object.assign(new Error("voice_disclosure_version"), { statusCode: 409 });
  }
  record.disclosureAcknowledged = true;
  touch(record);
  saveVoiceSession(record);
  return record;
}

export function assertDisclosure(record: VoiceSessionRecord): void {
  if (!record.disclosureAcknowledged) {
    throw Object.assign(new Error("voice_disclosure_required"), { statusCode: 403 });
  }
}

export function submitAnswer(sessionId: string, text: string): VoiceSessionRecord {
  const record = requireOpenSession(sessionId);
  assertDisclosure(record);
  const trimmed = text.trim();
  const fact: ReportedFact = {
    id: randomUUID(),
    kind: SELF_DIAGNOSIS.test(trimmed) ? "self_label_not_a_diagnosis" : "patient_statement",
    value: trimmed,
    confidence: "explicit",
  };
  record.session.facts.push(fact);
  record.session.symptoms.push(extractSymptom(trimmed));
  refresh(record);
  return record;
}

function extractSymptom(text: string): ReportedSymptom {
  const severityMatch = text.match(/\b([0-9]|10)\s*\/\s*10\b/) ?? text.match(/\b(?:pain|uchungu)\s*(?:is|=)?\s*([0-9]|10)\b/i);
  const severity = severityMatch?.[1] ? Number.parseInt(severityMatch[1], 10) : undefined;
  const concept = SELF_DIAGNOSIS.test(text) ? "unspecified_symptom" : "reported_experience";
  return {
    id: randomUUID(),
    concept,
    patientWording: text,
    onset: /\b(yesterday|jana|hours?|masaa|days?|siku)\b/i.test(text) ? text : undefined,
    duration: /\b(since|tangu|for)\b/i.test(text) ? text : undefined,
    severity,
    confidence: SELF_DIAGNOSIS.test(text) ? "uncertain" : "explicit",
  };
}

export function nextQuestion(record: VoiceSessionRecord): string {
  const sw = record.session.locale.toLowerCase().startsWith("sw");
  const usedSelfLabel = record.session.facts.some((fact) => fact.kind === "self_label_not_a_diagnosis");
  const hasReportedExperience = record.session.symptoms.some(
    (item) => item.concept === "reported_experience",
  );
  if (usedSelfLabel && !hasReportedExperience) {
    return sw
      ? "Umetaja jina la ugonjwa. Unaona nini au unahisi nini mwilini mwako? Eleza dalili, si jina la ugonjwa."
      : "You named a condition. What are you actually experiencing in your body? Describe the symptoms, not a disease name.";
  }
  const missing = record.session.safety.missingCriticalFacts;
  if (missing.includes("primary_experience")) {
    return sw
      ? "Unaona nini au unahisi nini sasa? Eleza dalili, si jina la ugonjwa."
      : "What are you experiencing right now? Describe the symptoms, not a disease name.";
  }
  if (missing.includes("onset_or_duration")) {
    return sw ? "Hii ilianza lini, na imedumu kwa muda gani?" : "When did this start, and how long has it lasted?";
  }
  if (missing.includes("severity")) {
    return sw
      ? "Kwa kiwango cha 0 hadi 10, unaona uchungu au usumbufu kiasi gani?"
      : "On a scale of 0 to 10, how intense is the pain or discomfort?";
  }
  return sw
    ? "Asante. Naweza kutoa muhtasari wa kile ulichoripoti, bila utambuzi."
    : "Thank you. I can now give a factual summary of what you reported, without a diagnosis.";
}

export function buildSummary(record: VoiceSessionRecord): ConsultationSummary {
  const reported = record.session.symptoms
    .filter((item) => item.confidence !== "uncertain" || item.concept === "unspecified_symptom")
    .map((item) => item.patientWording ?? item.concept);
  const denied: string[] = [];
  const unknown = record.session.safety.missingCriticalFacts;
  const nextAction =
    record.session.safety.urgency === "emergency"
      ? "Seek emergency care now. Do not wait for a callback or message."
      : "A healthcare professional should review these reported facts. KKD does not diagnose.";

  const summary: ConsultationSummary = {
    reasonForSeekingCare: reported[0] ?? "Not established",
    symptomsReported: reported,
    timeline: record.session.symptoms.find((item) => item.onset)?.onset,
    severityAndMeasurements: record.session.symptoms
      .filter((item) => item.severity !== undefined)
      .map((item) => `reported intensity ${item.severity}/10`),
    associatedSymptoms: [],
    symptomsExplicitlyDenied: denied,
    medicationAlreadyTaken: [],
    relevantContext: record.session.facts
      .filter((fact) => fact.kind === "self_label_not_a_diagnosis")
      .map(() => "Patient used a self-label; it was not treated as a diagnosis."),
    unknownOrUnanswered: unknown,
    recommendedNextAction: stripDiagnosticLanguage(nextAction),
    urgency: record.session.safety.urgency,
    promptId: "voice.summary.stub",
    promptVersion: "0.1.0",
    model: "none-deterministic-stub",
  };
  return {
    ...summary,
    reasonForSeekingCare: stripDiagnosticLanguage(summary.reasonForSeekingCare),
  };
}

export function closeSession(sessionId: string): VoiceSessionRecord {
  const record = requireOpenSession(sessionId);
  record.closed = true;
  record.mockCallStatus = "ended";
  refresh(record);
  deleteVoiceSession(sessionId);
  return record;
}

function refresh(record: VoiceSessionRecord): void {
  record.session.safety = evaluateVoiceSafety(record);
  const missing = record.session.safety.missingCriticalFacts;
  const answered = 3 - missing.length;
  record.session.completion = {
    percent: Math.max(0, Math.min(100, Math.round((answered / 3) * 100))),
    missingFieldIds: missing,
  };
  touch(record);
  saveVoiceSession(record);
}

function touch(record: VoiceSessionRecord): void {
  record.session.lastActivityAt = new Date().toISOString();
}

export function requestInterviewCallback(record: VoiceSessionRecord): {
  alreadyRequested: boolean;
  idempotencyKey: string;
} {
  if (record.callbackStatus === "requested" && record.callbackIdempotencyKey) {
    return { alreadyRequested: true, idempotencyKey: record.callbackIdempotencyKey };
  }
  const idempotencyKey = `callback:${record.session.id}`;
  record.callbackStatus = "requested";
  record.callbackIdempotencyKey = idempotencyKey;
  saveVoiceSession(record);
  return { alreadyRequested: false, idempotencyKey };
}

export function cancelInterviewCallback(sessionId: string): VoiceSessionRecord {
  const record = requireOpenSession(sessionId);
  assertDisclosure(record);
  if (record.callbackStatus === "none") {
    throw Object.assign(new Error("voice_callback_not_found"), { statusCode: 409 });
  }
  record.callbackStatus = "cancelled";
  saveVoiceSession(record);
  return record;
}
