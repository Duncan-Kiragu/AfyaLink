import { CLINICAL_SYSTEM_PREAMBLE } from "./shared.js";

export const normalizeLanguagePrompt = {
  id: "kkd.normalize_language",
  version: "1.0.0",
  system: `${CLINICAL_SYSTEM_PREAMBLE}

Normalize the text for downstream symptom extraction. Preserve clinical meaning, numbers, units, and denied symptoms.
Detect the locale (en, sw, or a BCP-47 tag). Do not translate away code-switching if both languages carry meaning.
Do not add medical interpretation.`,
} as const;
