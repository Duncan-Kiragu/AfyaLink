import { z } from "zod";
import { channelSchema } from "./common.js";

export const healthRecordEntryTypeSchema = z.enum([
  "symptom",
  "measurement",
  "medication_report",
  "checkin",
  "note",
]);
export type HealthRecordEntryType = z.infer<typeof healthRecordEntryTypeSchema>;

export const healthRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  createdAt: z.string(),
});
export type HealthRecord = z.infer<typeof healthRecordSchema>;

export const recordEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  recordId: z.string(),
  entryType: healthRecordEntryTypeSchema,
  conceptCode: z.string().optional(),
  patientWording: z.string().optional(),
  valueJson: z.unknown(),
  effectiveAt: z.string(),
  sourceChannel: channelSchema,
  sourceSessionIdHash: z.string().optional(),
  createdAt: z.string(),
});
export type RecordEntry = z.infer<typeof recordEntrySchema>;

export const createRecordInputSchema = z.object({
  label: z.string().optional(),
});
export type CreateRecordInput = z.infer<typeof createRecordInputSchema>;

export const recordEntryInputSchema = z.object({
  entryType: healthRecordEntryTypeSchema,
  conceptCode: z.string().optional(),
  patientWording: z.string().optional(),
  valueJson: z.unknown(),
  effectiveAt: z.string(),
  sourceChannel: channelSchema,
});
export type RecordEntryInput = z.infer<typeof recordEntryInputSchema>;

export const recordFiltersSchema = z.object({
  entryType: healthRecordEntryTypeSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type RecordFilters = z.infer<typeof recordFiltersSchema>;

export const exportFormatSchema = z.enum(["json", "pdf"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export const exportJobSchema = z.object({
  jobId: z.string(),
  status: z.enum(["queued", "completed", "failed"]),
});
export type ExportJob = z.infer<typeof exportJobSchema>;

export interface HealthRecordService {
  createRecord(userId: string, input: CreateRecordInput): Promise<HealthRecord>;
  appendEntry(
    userId: string,
    recordId: string,
    input: RecordEntryInput,
  ): Promise<RecordEntry>;
  listEntries(userId: string, filters: RecordFilters): Promise<RecordEntry[]>;
  exportRecord(userId: string, format: ExportFormat): Promise<ExportJob>;
  deleteRecord(userId: string, recordId: string): Promise<void>;
}
