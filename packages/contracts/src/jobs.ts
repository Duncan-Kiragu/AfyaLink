import { z } from "zod";
import { careCategorySchema } from "./integrations.js";

export const QUEUE_NAMES = [
  "followups",
  "notifications",
  "provider-sync",
  "voice-callbacks",
  "exports",
  "purges",
  "analytics",
] as const;

export const queueNameSchema = z.enum(QUEUE_NAMES);
export type QueueName = z.infer<typeof queueNameSchema>;

export const jobEnvelopeSchema = z.object({
  queue: queueNameSchema,
  idempotencyKey: z.string(),
  payload: z.unknown(),
});
export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;

export const providerSyncPayloadSchema = z.object({
  careCategories: z.array(careCategorySchema).optional(),
  // Coordinates are optional: a sync may target an area by name alone.
  locations: z.array(z.object({
    name: z.string(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  })).optional(),
});
export type ProviderSyncPayload = z.infer<typeof providerSyncPayloadSchema>;
