import type { SafetyRule } from "../rule-schema.js";

/**
 * First red-flag rule set — DRAFT, NOT CLINICALLY REVIEWED.
 *
 * Every rule has status "draft" and carries no `reviewedBy`/`reviewedAt`, because KKD
 * has no assigned clinical reviewer (spec §3 assigns none; §8.2, §8.3.A, §8.3.B and
 * §8.3.D all require clinical review). Thresholds below are placeholders chosen to
 * exercise the engine, not clinical recommendations.
 *
 * Rules describe reported observations and never name a disease (product constitution
 * §1.1). `patientMessageKey` values are i18n keys only; the reviewed strings are
 * Brian's to author in `@kkd/i18n` (spec §10.4.A).
 *
 * Format and review process: `docs/clinical-rules/README.md`.
 */
export const RED_FLAGS_V0_1_0_DRAFT_VERSION = "red-flags@0.1.0-draft";

export const redFlagsV0_1_0Draft: readonly SafetyRule[] = [
  {
    id: "rf.chest_pain_with_breathlessness",
    version: "0.1.0",
    status: "draft",
    requiredInputs: ["symptom.chest_pain", "symptom.breathlessness"],
    conditions: [
      { kind: "symptom_reported", concept: "chest_pain" },
      { kind: "symptom_reported", concept: "breathlessness" },
    ],
    urgencyResult: "emergency",
    patientMessageKey: "severity.explanation.chest_pain_with_breathlessness",
    requiresHumanEscalation: true,
    clinicalRationale:
      "Placeholder pending clinical review. Chest pain reported together with breathlessness is a standard immediate-escalation trigger in triage protocols.",
  },
  {
    id: "rf.fever_with_neck_stiffness",
    version: "0.1.0",
    status: "draft",
    requiredInputs: ["symptom.fever", "symptom.neck_stiffness"],
    conditions: [
      { kind: "symptom_reported", concept: "fever" },
      { kind: "symptom_reported", concept: "neck_stiffness" },
    ],
    urgencyResult: "emergency",
    patientMessageKey: "severity.explanation.fever_with_neck_stiffness",
    requiresHumanEscalation: true,
    clinicalRationale:
      "Placeholder pending clinical review. Fever reported together with neck stiffness is a recognised immediate-escalation trigger.",
  },
  {
    id: "rf.uncontrolled_bleeding",
    version: "0.1.0",
    status: "draft",
    requiredInputs: ["symptom.uncontrolled_bleeding"],
    conditions: [{ kind: "symptom_reported", concept: "uncontrolled_bleeding" }],
    urgencyResult: "emergency",
    patientMessageKey: "severity.explanation.uncontrolled_bleeding",
    requiresHumanEscalation: true,
    clinicalRationale:
      "Placeholder pending clinical review. Bleeding the patient reports as uncontrolled is an immediate-escalation trigger.",
  },
  {
    id: "rf.measured_high_fever",
    version: "0.1.0",
    status: "draft",
    requiredInputs: ["measurement.temperature_c"],
    conditions: [
      {
        kind: "measurement_at_least",
        measurement: "temperature_c",
        value: 39.5,
        unit: "C",
      },
    ],
    urgencyResult: "urgent_today",
    patientMessageKey: "severity.explanation.measured_high_fever",
    requiresHumanEscalation: false,
    clinicalRationale:
      "Placeholder pending clinical review. Threshold and unit handling require sign-off before this rule leaves draft.",
  },
  {
    id: "rf.severe_abdominal_pain_without_relief",
    version: "0.1.0",
    status: "draft",
    requiredInputs: ["symptom.abdominal_pain", "symptom.abdominal_pain.severity"],
    conditions: [
      { kind: "symptom_severity_at_least", concept: "abdominal_pain", value: 8 },
      // Exercises explicit denial (spec §5.2): only a stated denial counts, never silence.
      {
        kind: "none_of",
        conditions: [{ kind: "symptom_denied", concept: "abdominal_pain" }],
      },
    ],
    urgencyResult: "urgent_today",
    patientMessageKey: "severity.explanation.severe_abdominal_pain",
    requiresHumanEscalation: false,
    clinicalRationale:
      "Placeholder pending clinical review. Patient-rated intensity alone is a weak trigger; threshold requires sign-off.",
  },
];
