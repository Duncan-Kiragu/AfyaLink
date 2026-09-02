import { z } from "zod";
import { channelSchema } from "./common.js";

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

export const sessionPurgeJobSchema = z
  .object({
    kind: z.literal("session_purge"),
    idempotencyKey: z.string(),
    sessionId: z.string().uuid(),
  })
  .strict();
export type SessionPurgeJob = z.infer<typeof sessionPurgeJobSchema>;

export const sessionOrphanSweepJobSchema = z
  .object({
    kind: z.literal("session_orphan_sweep"),
    idempotencyKey: z.string(),
  })
  .strict();
export type SessionOrphanSweepJob = z.infer<typeof sessionOrphanSweepJobSchema>;

export const purgeJobPayloadSchema = z.discriminatedUnion("kind", [
  recordPurgeVerifyJobSchema,
  sessionPurgeJobSchema,
  sessionOrphanSweepJobSchema,
]);
export type PurgeJobPayload = z.infer<typeof purgeJobPayloadSchema>;

export const followupJobSchema = z
  .object({
    kind: z.literal("followup_due"),
    idempotencyKey: z.string(),
    scheduleId: z.string().uuid(),
    userId: z.string().uuid(),
  })
  .strict();
export type FollowupJob = z.infer<typeof followupJobSchema>;

export const notificationJobSchema = z
  .object({
    kind: z.literal("notification"),
    idempotencyKey: z.string(),
    channel: channelSchema,
    templateId: z.string(),
  })
  .strict();
export type NotificationJob = z.infer<typeof notificationJobSchema>;

export const providerSyncJobSchema = z
  .object({
    kind: z.literal("provider_sync"),
    idempotencyKey: z.string(),
    source: z.string(),
  })
  .strict();
export type ProviderSyncJob = z.infer<typeof providerSyncJobSchema>;

export const analyticsJobSchema = z
  .object({
    kind: z.literal("queue_probe"),
    idempotencyKey: z.string().min(1),
  })
  .strict();
export type AnalyticsJob = z.infer<typeof analyticsJobSchema>;

export const exportJobPayloadSchema = recordExportJobSchema;
