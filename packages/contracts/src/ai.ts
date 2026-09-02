import { z } from "zod";
import { channelSchema } from "./common.js";
import { factConfidenceSchema } from "./symptoms.js";
import { urgencyClassSchema } from "./safety.js";

export const extractFactsInputSchema = z.object({
  sessionId: z.string(),
  locale: z.string(),
  patientText: z.string(),
  existingFactIds: z.array(z.string()).default([]),
});
export type ExtractFactsInput = z.infer<typeof extractFactsInputSchema>;

export const reportedFactsSchema = z.object({
  facts: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      value: z.unknown(),
      confidence: factConfidenceSchema,
    }),
  ),
  promptId: z.string(),
  promptVersion: z.string(),
  model: z.string(),
});
export type ReportedFacts = z.infer<typeof reportedFactsSchema>;

export const questionPlanInputSchema = z.object({
  sessionId: z.string(),
  locale: z.string(),
  missingFieldIds: z.array(z.string()),
});
export type QuestionPlanInput = z.infer<typeof questionPlanInputSchema>;

export const questionPlanSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  promptId: z.string(),
  promptVersion: z.string(),
  model: z.string(),
});
export type QuestionPlan = z.infer<typeof questionPlanSchema>;

export const summaryInputSchema = z.object({
  sessionId: z.string(),
  locale: z.string(),
  channel: channelSchema,
});
export type SummaryInput = z.infer<typeof summaryInputSchema>;

export const consultationSummarySchema = z.object({
  reasonForSeekingCare: z.string(),
  symptomsReported: z.array(z.string()),
  timeline: z.string().optional(),
  severityAndMeasurements: z.array(z.string()),
  associatedSymptoms: z.array(z.string()),
  symptomsExplicitlyDenied: z.array(z.string()),
  medicationAlreadyTaken: z.array(z.string()),
  relevantContext: z.array(z.string()),
  unknownOrUnanswered: z.array(z.string()),
  recommendedNextAction: z.string(),
  urgency: urgencyClassSchema,
  promptId: z.string(),
  promptVersion: z.string(),
  model: z.string(),
});
export type ConsultationSummary = z.infer<typeof consultationSummarySchema>;

export const normalizeLanguageInputSchema = z.object({
  text: z.string(),
  localeHint: z.string().optional(),
});
export type NormalizeLanguageInput = z.infer<typeof normalizeLanguageInputSchema>;

export const normalizedTextSchema = z.object({
  text: z.string(),
  locale: z.string(),
});
export type NormalizedText = z.infer<typeof normalizedTextSchema>;

export interface KkdAiService {
  extractReportedFacts(input: ExtractFactsInput): Promise<ReportedFacts>;
  planNextQuestion(input: QuestionPlanInput): Promise<QuestionPlan>;
  summarizeSession(input: SummaryInput): Promise<ConsultationSummary>;
  normalizeLanguage(input: NormalizeLanguageInput): Promise<NormalizedText>;
}
