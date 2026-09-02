import { extractFactsPrompt } from "./extract-facts.js";
import { normalizeLanguagePrompt } from "./normalize-language.js";
import { planQuestionPrompt } from "./plan-question.js";
import { summarizePrompt } from "./summarize.js";

export const prompts = {
  extractReportedFacts: extractFactsPrompt,
  planNextQuestion: planQuestionPrompt,
  summarizeSession: summarizePrompt,
  normalizeLanguage: normalizeLanguagePrompt,
} as const;

export type PromptDefinition = (typeof prompts)[keyof typeof prompts];

export {
  extractFactsPrompt,
  normalizeLanguagePrompt,
  planQuestionPrompt,
  summarizePrompt,
};
