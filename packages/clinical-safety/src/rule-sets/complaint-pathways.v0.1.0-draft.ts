import type { ComplaintPathway } from "../pathway-schema.js";

/**
 * Complaint-pathway required-field tables — DRAFT, NOT CLINICALLY REVIEWED.
 *
 * For a presenting complaint, these state which facts must be established before any
 * disposition is trustworthy (spec §8.3.B step 4), and in what order they should be
 * asked (step 5).
 *
 * They cover the complaints the `red-flags@0.1.0-draft` rules act on, so that for any
 * complaint those rules can fire on, the engine can also say what it still needs. A
 * complaint with no table here yields `unknownReason: "no_pathway_matched"` — the engine
 * declining to claim it screened anything, rather than implying nothing was found.
 *
 * Every pathway has status "draft" and no `reviewedBy`/`reviewedAt`, because KKD has no
 * assigned clinical reviewer (see `docs/clinical-rules/README.md`). Which fields are
 * critical, and their priorities, are placeholders chosen to exercise the engine.
 *
 * Field ids share the vocabulary of a rule's `requiredInputs`. `questionKey` values are
 * i18n keys only; the reviewed wording is Brian's to author in `@kkd/i18n` (spec §10.4.A).
 *
 * These tables are pinned into the `red-flags@0.1.0-draft` rule set rather than versioned
 * separately: a rule set version pins the rules *and* the pathway tables reviewed with
 * them, so `SafetyAssessment.ruleSetVersion` identifies everything that decided the
 * assessment, including its `missingCriticalFacts` (spec §8.7).
 */

export const complaintPathwaysV0_1_0Draft: readonly ComplaintPathway[] = [
  {
    id: "pathway.chest_pain",
    version: "0.1.0",
    status: "draft",
    presentingConcepts: ["chest_pain"],
    requiredFields: [
      {
        id: "symptom.breathlessness",
        priority: 10,
        establishedBy: { kind: "symptom_presence", concept: "breathlessness" },
        questionKey: "severity.question.breathlessness",
        rationale:
          "Discriminator for rf.chest_pain_with_breathlessness. Until it is reported or denied, no chest-pain disposition can be trusted.",
      },
      {
        id: "symptom.chest_pain.severity",
        priority: 20,
        establishedBy: {
          kind: "symptom_attribute",
          concept: "chest_pain",
          attribute: "severity",
        },
        questionKey: "severity.question.chest_pain_severity",
      },
      {
        id: "symptom.chest_pain.onset",
        priority: 30,
        establishedBy: {
          kind: "symptom_attribute",
          concept: "chest_pain",
          attribute: "onset",
        },
        questionKey: "severity.question.chest_pain_onset",
      },
      {
        id: "symptom.chest_pain.duration",
        priority: 40,
        establishedBy: {
          kind: "symptom_attribute",
          concept: "chest_pain",
          attribute: "duration",
        },
        questionKey: "severity.question.chest_pain_duration",
      },
    ],
    clinicalRationale:
      "Placeholder pending clinical review. Reported chest pain is screened for breathlessness before any detail question.",
  },
  {
    id: "pathway.breathlessness",
    version: "0.1.0",
    status: "draft",
    presentingConcepts: ["breathlessness"],
    requiredFields: [
      {
        id: "symptom.chest_pain",
        priority: 10,
        establishedBy: { kind: "symptom_presence", concept: "chest_pain" },
        questionKey: "severity.question.chest_pain",
        rationale:
          "The mirror of pathway.chest_pain, so the same rule is reachable whichever symptom the patient mentions first.",
      },
      {
        id: "symptom.breathlessness.onset",
        priority: 30,
        establishedBy: {
          kind: "symptom_attribute",
          concept: "breathlessness",
          attribute: "onset",
        },
        questionKey: "severity.question.breathlessness_onset",
      },
    ],
    clinicalRationale:
      "Placeholder pending clinical review. Mirrors pathway.chest_pain so conversation order cannot decide which questions are asked.",
  },
  {
    id: "pathway.fever",
    version: "0.1.0",
    status: "draft",
    presentingConcepts: ["fever"],
    requiredFields: [
      {
        id: "symptom.neck_stiffness",
        priority: 10,
        establishedBy: { kind: "symptom_presence", concept: "neck_stiffness" },
        questionKey: "severity.question.neck_stiffness",
        rationale: "Discriminator for rf.fever_with_neck_stiffness.",
      },
      {
        id: "measurement.temperature_c",
        priority: 20,
        establishedBy: {
          kind: "any_of",
          establishedBy: [
            { kind: "measurement", measurement: "temperature_c", unit: "C" },
            { kind: "fact", factKind: "measurement.temperature_c.unavailable" },
          ],
        },
        questionKey: "severity.question.temperature_measured",
        rationale:
          "Input to rf.measured_high_fever. The any_of branch lets a patient with no thermometer settle the field instead of leaving the pathway permanently incomplete.",
      },
      {
        id: "fact.exposure.recent_travel_risk_area",
        priority: 30,
        establishedBy: { kind: "fact", factKind: "exposure.recent_travel_risk_area" },
        questionKey: "severity.question.recent_travel_risk_area",
        rationale: "Input to rf.fever_with_recent_risk_area_travel.",
      },
      {
        id: "symptom.fever.duration",
        priority: 40,
        establishedBy: {
          kind: "symptom_attribute",
          concept: "fever",
          attribute: "duration",
        },
        questionKey: "severity.question.fever_duration",
      },
    ],
    clinicalRationale:
      "Placeholder pending clinical review. Reported fever is screened for neck stiffness first, then measured, before any detail question.",
  },
  {
    id: "pathway.abdominal_pain",
    version: "0.1.0",
    status: "draft",
    presentingConcepts: ["abdominal_pain"],
    requiredFields: [
      {
        id: "symptom.abdominal_pain.severity",
        priority: 10,
        establishedBy: {
          kind: "symptom_attribute",
          concept: "abdominal_pain",
          attribute: "severity",
        },
        questionKey: "severity.question.abdominal_pain_severity",
        rationale: "Input to rf.severe_abdominal_pain_without_relief.",
      },
      {
        id: "symptom.vomiting",
        priority: 20,
        establishedBy: { kind: "symptom_presence", concept: "vomiting" },
        questionKey: "severity.question.vomiting",
      },
      {
        id: "symptom.abdominal_pain.onset",
        priority: 30,
        establishedBy: {
          kind: "symptom_attribute",
          concept: "abdominal_pain",
          attribute: "onset",
        },
        questionKey: "severity.question.abdominal_pain_onset",
      },
      {
        id: "symptom.abdominal_pain.location",
        priority: 40,
        establishedBy: {
          kind: "symptom_attribute",
          concept: "abdominal_pain",
          attribute: "location",
        },
        questionKey: "severity.question.abdominal_pain_location",
      },
    ],
    clinicalRationale:
      "Placeholder pending clinical review. Patient-rated intensity is established before detail questions; no field here asserts a cause.",
  },
  {
    id: "pathway.bleeding",
    version: "0.1.0",
    status: "draft",
    presentingConcepts: ["bleeding", "uncontrolled_bleeding"],
    requiredFields: [
      {
        id: "symptom.uncontrolled_bleeding",
        priority: 10,
        establishedBy: { kind: "symptom_presence", concept: "uncontrolled_bleeding" },
        questionKey: "severity.question.bleeding_controlled",
        rationale:
          "Discriminator for rf.uncontrolled_bleeding. Reported bleeding says nothing about whether it has stopped.",
      },
      {
        id: "symptom.dizziness",
        priority: 20,
        establishedBy: { kind: "symptom_presence", concept: "dizziness" },
        questionKey: "severity.question.dizziness",
      },
    ],
    clinicalRationale:
      "Placeholder pending clinical review. Reported bleeding is screened for whether the patient describes it as uncontrolled before any detail question.",
  },
];
