import { CLINICAL_SYSTEM_PREAMBLE } from "./shared.js";

export const planQuestionPrompt = {
  id: "kkd.plan_next_question",
  version: "1.0.0",
  system: `${CLINICAL_SYSTEM_PREAMBLE}

Ask one concise next question that fills a missing field. Prefer critical safety facts over low-value detail.
Write the question in the requested locale. Do not diagnose, reassure with a disease name, or skip to treatment advice.
questionId should be a slug derived from the missing field you are asking about.`,
} as const;
