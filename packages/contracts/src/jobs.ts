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

export const recordExportJobSchema = z
  .object({
    kind: z.literal("record_export"),
    idempotencyKey: z.string(),
    jobId: z.string().uuid(),
    recordId: z.string().uuid(),
    userId: z.string().uuid(),
    format: z.literal("json"),
  })
  .strict();
export type RecordExportJob = z.infer<typeof recordExportJobSchema>;

export const recordPurgeVerifyJobSchema = z
  .object({
    kind: z.literal("record_purge_verify"),
    idempotencyKey: z.string(),
    recordId: z.string().uuid(),
    userId: z.string().uuid(),
  })
  .strict();
export type RecordPurgeVerifyJob = z.infer<typeof recordPurgeVerifyJobSchema>;

export const exportJobPayloadSchema = recordExportJobSchema;
export const purgeJobPayloadSchema = recordPurgeVerifyJobSchema;
