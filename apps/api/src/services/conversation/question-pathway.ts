import type { QuestionField, QuestionPathway } from "@kkd/contracts";
import { CHOICE_SYNONYMS } from "@kkd/integrations/channel";

/**
 * Question pathways: the ordered fields an interview tries to fill.
 *
 * OWNERSHIP: the clinical content of this file belongs to the severity /
 * health-profiling workstream (spec §8.3, Antonia). It lives here as a
 * deterministic fallback so every channel — web, WhatsApp, USSD — asks the same
 * questions in the same order instead of each inventing a question tree, which
 * §3.1 forbids. When the clinical-safety rule engine lands, replace
 * `getPathway` with a lookup into `packages/clinical-safety` and delete these
 * literals; nothing outside this module depends on them.
 *
 * STATUS: awaiting clinical review. These are generic symptom-description
 * fields (onset, location, severity, associated symptoms) chosen because they
 * are descriptive rather than diagnostic — none of them narrows to a disease.
 */
export const PATHWAY_REVIEW_STATUS = "awaiting_clinical_review" as const;

const yesNoUnsure = [
  { id: "yes", labelKey: "channel.choice.yes", synonyms: [...CHOICE_SYNONYMS.yes] },
  { id: "no", labelKey: "channel.choice.no", synonyms: [...CHOICE_SYNONYMS.no] },
  { id: "unsure", labelKey: "channel.choice.unsure", synonyms: [...CHOICE_SYNONYMS.unsure] },
];

/**
 * Step one on every channel: which part of the body / kind of problem. Note
 * these are *symptom* categories, not conditions.
 */
export const SYMPTOM_CATEGORY_FIELD: QuestionField = {
  id: "symptom_category",
  promptKey: "channel.ussd.symptomCategory",
  inputKind: "choice",
  critical: true,
  choices: [
    { id: "pain", label: "Pain somewhere", synonyms: ["pain", "uchungu", "maumivu"] },
    { id: "fever", label: "Fever or chills", synonyms: ["fever", "homa"] },
    { id: "breathing", label: "Breathing problem", synonyms: ["breathing", "kupumua"] },
    { id: "stomach", label: "Stomach or bowels", synonyms: ["stomach", "tumbo"] },
    { id: "injury", label: "Injury or bleeding", synonyms: ["injury", "jeraha"] },
    { id: "other", label: "Something else", synonyms: ["other", "nyingine"] },
  ],
};

const GENERIC_FIELDS: QuestionField[] = [
  {
    id: "onset",
    promptKey: "pathway.generic.onset",
    inputKind: "free_text",
    critical: true,
    choices: [],
  },
  {
    id: "location",
    promptKey: "pathway.generic.location",
    inputKind: "free_text",
    critical: true,
    choices: [],
  },
  {
    id: "severity",
    promptKey: "pathway.generic.severity",
    inputKind: "severity_scale",
    critical: true,
    choices: [],
  },
  {
    id: "worsening",
    promptKey: "pathway.generic.worsening",
    inputKind: "choice",
    critical: true,
    choices: yesNoUnsure,
  },
  {
    id: "associated",
    promptKey: "pathway.generic.associated",
    inputKind: "free_text",
    critical: false,
    choices: [],
  },
  {
    id: "medication_taken",
    promptKey: "pathway.generic.medicationTaken",
    inputKind: "free_text",
    critical: false,
    choices: [],
  },
];

const GENERIC_PATHWAY: QuestionPathway = {
  id: "generic.v0",
  version: "0.1.0-draft",
  fields: [SYMPTOM_CATEGORY_FIELD, ...GENERIC_FIELDS],
};

export function getPathway(_categoryId?: string): QuestionPathway {
  // One pathway for now. Category-specific pathways arrive with the clinical
  // rule set; the signature is already category-aware so callers do not change.
  return GENERIC_PATHWAY;
}

/** Critical fields first, then detail — never the reverse (spec §8.3B). */
export function nextUnansweredField(
  pathway: QuestionPathway,
  answeredFieldIds: readonly string[],
): QuestionField | undefined {
  const answered = new Set(answeredFieldIds);
  return (
    pathway.fields.find((field) => field.critical && !answered.has(field.id)) ??
    pathway.fields.find((field) => !answered.has(field.id))
  );
}

/**
 * Completeness is the share of pathway fields the patient actually answered.
 * Inferred or model-guessed values must not move it (spec §6.3D).
 */
export function completenessPercent(
  pathway: QuestionPathway,
  answeredFieldIds: readonly string[],
): number {
  if (pathway.fields.length === 0) return 0;
  const known = new Set(pathway.fields.map((field) => field.id));
  const answered = answeredFieldIds.filter((id) => known.has(id)).length;
  return Math.round((answered / pathway.fields.length) * 100);
}

export function missingFieldIds(
  pathway: QuestionPathway,
  answeredFieldIds: readonly string[],
): string[] {
  const answered = new Set(answeredFieldIds);
  return pathway.fields.filter((field) => !answered.has(field.id)).map((field) => field.id);
}
