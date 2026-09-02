import { z } from "zod";
import { urgencyClassSchema } from "./safety.js";

export const dataClassificationSchema = z.enum([
  "public",
  "operational",
  "health_ephemeral",
  "health_persistent",
  "secret",
]);
export type DataClassification = z.infer<typeof dataClassificationSchema>;

export const integrationContextSchema = z.object({
  requestId: z.string(),
  timeoutMs: z.number().int().positive(),
});
export type IntegrationContext = z.infer<typeof integrationContextSchema>;

export interface ExternalApiAdapter<TQuery, TResult> {
  validateConfig(): Promise<void>;
  execute(query: TQuery, ctx: IntegrationContext): Promise<TResult>;
  normalize(raw: unknown): TResult;
}

export const careCategorySchema = z.enum([
  "emergency_department",
  "urgent_care",
  "primary_care",
  "paediatrics",
  "obstetric_care",
  "eye_care",
  "dental_care",
  "mental_health",
  "pharmacy",
  "laboratory",
  "telemedicine",
]);
export type CareCategory = z.infer<typeof careCategorySchema>;

export const providerSearchInputSchema = z.object({
  careCategory: careCategorySchema,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  areaQuery: z.string().optional(),
  urgency: urgencyClassSchema.optional(),
});
export type ProviderSearchInput = z.infer<typeof providerSearchInputSchema>;

export const normalizedProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  facilityType: z.string(),
  careCategories: z.array(careCategorySchema),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  openingStatus: z.string().optional(),
  bookingUrl: z.string().optional(),
  source: z.string(),
  sourceRecordId: z.string(),
  lastVerifiedAt: z.string(),
});
export type NormalizedProvider = z.infer<typeof normalizedProviderSchema>;

export interface ProviderDirectoryAdapter {
  search(input: ProviderSearchInput): Promise<NormalizedProvider[]>;
  getDetails(providerId: string): Promise<NormalizedProvider>;
}
