import { z } from "zod";
import { channelSchema } from "./common.js";
import { storedScoreSnapshotSchema } from "./scores.js";
import { factConfidenceSchema } from "./symptoms.js";

export const RECORDS_CONSENT_PURPOSE = "health_record_persistence";
export const RECORDS_CONSENT_VERSION = "records.persist.v1";

export const healthRecordEntryTypeSchema = z.enum([
  "symptom",
  "measurement",
  "medication_report",
  "checkin",
  "note",
]);
export type HealthRecordEntryType = z.infer<typeof healthRecordEntryTypeSchema>;

export const healthRecordSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  label: z.string().optional(),
  createdAt: z.string(),
});
export type HealthRecord = z.infer<typeof healthRecordSchema>;

export const recordEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  recordId: z.string().uuid(),
  entryType: healthRecordEntryTypeSchema,
  conceptCode: z.string().optional(),
  patientWording: z.string().optional(),
  valueJson: z.record(z.string(), z.unknown()).optional(),
  effectiveAt: z.string(),
  sourceChannel: channelSchema,
  sourceSessionIdHash: z.string().optional(),
  createdAt: z.string(),
});
export type RecordEntry = z.infer<typeof recordEntrySchema>;

export const createRecordInputSchema = z
  .object({
    label: z.string().max(120).optional(),
  })
  .strict();
export type CreateRecordInput = z.infer<typeof createRecordInputSchema>;

export const recordEntryInputSchema = z
  .object({
    entryType: healthRecordEntryTypeSchema,
    conceptCode: z.string().max(80).optional(),
    patientWording: z.string().max(2000).optional(),
    valueJson: z.record(z.string(), z.unknown()).optional(),
    effectiveAt: z.string(),
    sourceChannel: channelSchema,
    sourceSessionIdHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict();
export type RecordEntryInput = z.infer<typeof recordEntryInputSchema>;

export const recordFiltersSchema = z.object({
  entryType: healthRecordEntryTypeSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type RecordFilters = z.infer<typeof recordFiltersSchema>;

export const exportFormatSchema = z.enum(["json", "pdf"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export const exportRecordInputSchema = z
  .object({
    format: exportFormatSchema.default("json"),
  })
  .strict();
export type ExportRecordInput = z.infer<typeof exportRecordInputSchema>;

export const exportJobSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(["queued", "completed", "failed"]),
  format: z.literal("json"),
  expiresAt: z.string().optional(),
  downloadPath: z.string().optional(),
});
export type ExportJob = z.infer<typeof exportJobSchema>;

export const persistableFactSchema = z
  .object({
    entryType: healthRecordEntryTypeSchema,
    conceptCode: z.string().max(80).optional(),
    patientWording: z.string().max(2000).optional(),
    valueJson: z.record(z.string(), z.unknown()).optional(),
    effectiveAt: z.string(),
    confidence: factConfidenceSchema,
  })
  .strict();
export type PersistableFact = z.infer<typeof persistableFactSchema>;

export const persistFactsInputSchema = z
  .object({
    consentVersion: z.string().min(1),
    sourceChannel: channelSchema,
    sourceSessionId: z.string().min(1).optional(),
    sourceSessionIdHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    facts: z.array(persistableFactSchema).min(1).max(50),
  })
  .strict();
export type PersistFactsInput = z.infer<typeof persistFactsInputSchema>;

export const persistFactsResultSchema = z.object({
  record: healthRecordSchema,
  entries: z.array(recordEntrySchema),
  persistedCount: z.number().int().nonnegative(),
});
export type PersistFactsResult = z.infer<typeof persistFactsResultSchema>;

export const persistFromVoiceInputSchema = z
  .object({
    consentVersion: z.string().min(1),
    sessionId: z.string().uuid(),
    selectedFactIds: z.array(z.string().min(1)).min(1).max(50),
  })
  .strict();
export type PersistFromVoiceInput = z.infer<typeof persistFromVoiceInputSchema>;

export const grantConsentInputSchema = z
  .object({
    version: z.string().min(1),
  })
  .strict();
export type GrantConsentInput = z.infer<typeof grantConsentInputSchema>;

export const consentRecordSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  version: z.string(),
  purpose: z.literal(RECORDS_CONSENT_PURPOSE),
  grantedAt: z.string(),
  withdrawnAt: z.string().optional(),
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;

export const consentStatusSchema = z.object({
  purpose: z.literal(RECORDS_CONSENT_PURPOSE),
  currentVersion: z.literal(RECORDS_CONSENT_VERSION),
  granted: z.boolean(),
  version: z.string().optional(),
  grantedAt: z.string().optional(),
  withdrawnAt: z.string().optional(),
});
export type ConsentStatus = z.infer<typeof consentStatusSchema>;

export const recordIdParamsSchema = z.object({
  id: z.string().uuid(),
});
export type RecordIdParams = z.infer<typeof recordIdParamsSchema>;

export const exportJobParamsSchema = z.object({
  jobId: z.string().uuid(),
});
export type ExportJobParams = z.infer<typeof exportJobParamsSchema>;

export const healthRecordListSchema = z.object({
  records: z.array(healthRecordSchema),
});
export type HealthRecordList = z.infer<typeof healthRecordListSchema>;

export const recordEntryListSchema = z.object({
  entries: z.array(recordEntrySchema),
});
export type RecordEntryList = z.infer<typeof recordEntryListSchema>;

export const recordExportBundleSchema = z
  .object({
    exportedAt: z.string(),
    notice: z.string(),
    record: healthRecordSchema,
    entries: z.array(recordEntrySchema),
    scores: z.array(storedScoreSnapshotSchema),
    consent: consentStatusSchema.optional(),
  })
  .strict();
export type RecordExportBundle = z.infer<typeof recordExportBundleSchema>;

export interface HealthRecordService {
  createRecord(userId: string, input: CreateRecordInput): Promise<HealthRecord>;
  listRecords(userId: string): Promise<HealthRecord[]>;
  getRecord(userId: string, recordId: string): Promise<HealthRecord>;
  appendEntry(
    userId: string,
    recordId: string,
    input: RecordEntryInput,
  ): Promise<RecordEntry>;
  listEntries(userId: string, recordId: string, filters: RecordFilters): Promise<RecordEntry[]>;
  persistSelectedFacts(
    userId: string,
    recordId: string,
    input: PersistFactsInput,
  ): Promise<PersistFactsResult>;
  exportRecord(userId: string, recordId: string, format: ExportFormat): Promise<ExportJob>;
  deleteRecord(userId: string, recordId: string): Promise<void>;
  deleteAllRecords(userId: string): Promise<number>;
}
