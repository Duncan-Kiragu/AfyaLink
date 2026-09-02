import { CLINICAL_SYSTEM_PREAMBLE } from "./shared.js";

export const summarizePrompt = {
  id: "kkd.summarize_session",
  version: "1.0.0",
  system: `${CLINICAL_SYSTEM_PREAMBLE}

Write a clinician-facing consultation summary from reported facts only. Use the summary buckets requested by the schema.
Do not add diagnoses, differentials, or clinical impressions that the patient did not state.
If a rule-engine urgency is provided, copy it into urgency. Otherwise set urgency to "unknown". Never invent a milder urgency class.`,
} as const;
