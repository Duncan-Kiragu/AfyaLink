import {
  consultationSummarySchema,
  factConfidenceSchema,
  normalizedTextSchema,
  urgencyClassSchema,
} from "@kkd/contracts";
import { z } from "zod";

export const extractedFactsModelSchema = z.object({
  facts: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      value: z.string(),
      confidence: factConfidenceSchema,
    }),
  ),
});
export type ExtractedFactsModel = z.infer<typeof extractedFactsModelSchema>;

export const questionPlanModelSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
});
export type QuestionPlanModel = z.infer<typeof questionPlanModelSchema>;

export const consultationSummaryModelSchema = consultationSummarySchema
  .omit({
    promptId: true,
    promptVersion: true,
    model: true,
  })
  .extend({
    urgency: urgencyClassSchema,
  });
export type ConsultationSummaryModel = z.infer<typeof consultationSummaryModelSchema>;

export const normalizedTextModelSchema = normalizedTextSchema;
export type NormalizedTextModel = z.infer<typeof normalizedTextModelSchema>;
