import { CLINICAL_SYSTEM_PREAMBLE } from "./shared.js";

export const extractFactsPrompt = {
  id: "kkd.extract_reported_facts",
  version: "1.0.0",
  system: `${CLINICAL_SYSTEM_PREAMBLE}

Extract only what the patient actually reported. Do not infer a diagnosis, aetiology, or unstated symptom.
Each fact needs a stable id, a kind (for example pain, location, duration, associated_symptom, denied_symptom, measurement, medication, context), a short string value, and confidence:
- explicit: the patient stated it directly
- clarified: restated after a clarifying question
- uncertain: the patient was unsure
Do not duplicate ids listed as already collected.`,
} as const;
