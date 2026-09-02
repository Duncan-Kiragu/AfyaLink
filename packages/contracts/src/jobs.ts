import { z } from "zod";

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
