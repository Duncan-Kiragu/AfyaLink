import type { SafetyAssessment } from "@kkd/contracts";
import type { VoiceSessionRecord } from "./voice.store.js";

const RULE_SET_VERSION = "voice-stub.v0";

const EMERGENCY_PATTERNS = [
  /\bcan'?t breathe\b/i,
  /\bcannot breathe\b/i,
  /\bnot breathing\b/i,
  /\bunconscious\b/i,
  /\bseizure\b/i,
  /\bbleeding (heavily|a lot)\b/i,
  /\bsinapumua\b/i,
  /\bamezimia\b/i,
];

export function evaluateVoiceSafety(session: VoiceSessionRecord): SafetyAssessment {
  const blob = [
    ...session.session.facts.map((fact) => String(fact.value)),
    ...session.session.symptoms.map((symptom) => symptom.patientWording ?? symptom.concept),
  ].join(" ");

  if (EMERGENCY_PATTERNS.some((pattern) => pattern.test(blob))) {
    return {
      urgency: "emergency",
      ruleIds: ["voice-stub.red-flag.immediate"],
      explanationKeys: ["urgency.emergency"],
      missingCriticalFacts: [],
      requiresHumanEscalation: true,
      ruleSetVersion: RULE_SET_VERSION,
    };
  }

  const pain = session.session.symptoms.find((item) => item.severity !== undefined)?.severity;
  if (pain !== undefined && pain >= 8) {
    return {
      urgency: "urgent_today",
      ruleIds: ["voice-stub.high-reported-intensity"],
      explanationKeys: ["voice.urgency.highIntensity"],
      missingCriticalFacts: missingFields(session),
      requiresHumanEscalation: false,
      ruleSetVersion: RULE_SET_VERSION,
    };
  }

  const missing = missingFields(session);
  if (missing.length > 0) {
    return {
      urgency: "unknown",
      ruleIds: ["voice-stub.incomplete"],
      explanationKeys: ["voice.urgency.needMore"],
      missingCriticalFacts: missing,
      requiresHumanEscalation: false,
      ruleSetVersion: RULE_SET_VERSION,
    };
  }

  return {
    urgency: "soon",
    ruleIds: ["voice-stub.complete-non-emergency"],
    explanationKeys: ["voice.urgency.soon"],
    missingCriticalFacts: [],
    requiresHumanEscalation: false,
    ruleSetVersion: RULE_SET_VERSION,
  };
}

function missingFields(session: VoiceSessionRecord): string[] {
  const missing: string[] = [];
  if (session.session.symptoms.length === 0 && session.session.facts.length === 0) {
    missing.push("primary_experience");
  }
  const hasTiming = session.session.symptoms.some((item) => item.onset || item.duration);
  if (!hasTiming) {
    missing.push("onset_or_duration");
  }
  const hasSeverity = session.session.symptoms.some((item) => item.severity !== undefined);
  if (!hasSeverity) {
    missing.push("severity");
  }
  return missing;
}
