import { z } from "zod";

export const measurementSchema = z.object({
  name: z.string(),
  value: z.string(),
  unit: z.string().optional(),
});
export type Measurement = z.infer<typeof measurementSchema>;

export const factConfidenceSchema = z.enum(["explicit", "clarified", "uncertain"]);
export type FactConfidence = z.infer<typeof factConfidenceSchema>;

export const reportedSymptomSchema = z.object({
  id: z.string(),
  concept: z.string(),
  patientWording: z.string().optional(),
  onset: z.string().optional(),
  duration: z.string().optional(),
  location: z.string().optional(),
  movement: z.string().optional(),
  severity: z.number().min(0).max(10).optional(),
  character: z.string().optional(),
  aggravatingFactors: z.array(z.string()).optional(),
  relievingFactors: z.array(z.string()).optional(),
  associatedSymptoms: z.array(z.string()).optional(),
  deniedSymptoms: z.array(z.string()).optional(),
  measurements: z.array(measurementSchema).optional(),
  confidence: factConfidenceSchema,
});
export type ReportedSymptom = z.infer<typeof reportedSymptomSchema>;

export const reportedFactSchema = z.object({
  id: z.string(),
  kind: z.string(),
  value: z.unknown(),
  confidence: factConfidenceSchema,
});
export type ReportedFact = z.infer<typeof reportedFactSchema>;

export const summaryBucketSchema = z.enum([
  "reported",
  "denied",
  "measured",
  "uncertain",
  "unknown",
]);
export type SummaryBucket = z.infer<typeof summaryBucketSchema>;
