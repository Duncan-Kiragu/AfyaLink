import {
  RECORDS_CONSENT_VERSION,
  apiV1,
  consentStatusSchema,
  exportJobSchema,
  healthRecordListSchema,
  healthRecordSchema,
  persistFactsResultSchema,
  recordEntryListSchema,
  recordExportBundleSchema,
  scoreListSchema,
  scoreSnapshotResponseSchema,
  type ExportJob,
  type HealthRecord,
  type PersistFactsResult,
  type RecordEntry,
  type RecordExportBundle,
  type StoredScoreSnapshot,
} from "@kkd/contracts";
import { apiClient } from "../../api";

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

async function expectOk(response: Response, fallback: string): Promise<void> {
  if (!response.ok) {
    throw new Error(fallback);
  }
}

export async function grantRecordsConsent() {
  const response = await apiClient.request(apiV1.recordConsent, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: RECORDS_CONSENT_VERSION }),
  });
  await expectOk(response, "consent_failed");
  return consentStatusSchema.parse(await readJson(response));
}

export async function listHealthRecords(): Promise<HealthRecord[]> {
  const response = await apiClient.request(apiV1.records);
  await expectOk(response, "records_list_failed");
  return healthRecordListSchema.parse(await readJson(response)).records;
}

export async function createHealthRecord(label: string): Promise<HealthRecord> {
  const response = await apiClient.request(apiV1.records, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label }),
  });
  await expectOk(response, "record_create_failed");
  return healthRecordSchema.parse(await readJson(response));
}

export async function persistFactsFromVoice(
  recordId: string,
  sessionId: string,
  selectedFactIds: string[],
): Promise<PersistFactsResult> {
  const response = await apiClient.request(apiV1.recordPersistFromVoice(recordId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      consentVersion: RECORDS_CONSENT_VERSION,
      sessionId,
      selectedFactIds,
    }),
  });
  await expectOk(response, "persist_failed");
  return persistFactsResultSchema.parse(await readJson(response));
}

export async function computeRecordScore(recordId: string): Promise<StoredScoreSnapshot> {
  const response = await apiClient.request(apiV1.recordScores(recordId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  await expectOk(response, "score_failed");
  return scoreSnapshotResponseSchema.parse(await readJson(response)).score;
}

export async function listRecordEntries(recordId: string): Promise<RecordEntry[]> {
  const response = await apiClient.request(apiV1.recordEntries(recordId));
  await expectOk(response, "entries_failed");
  return recordEntryListSchema.parse(await readJson(response)).entries;
}

export async function listRecordScores(recordId: string): Promise<StoredScoreSnapshot[]> {
  const response = await apiClient.request(apiV1.recordScores(recordId));
  await expectOk(response, "scores_failed");
  return scoreListSchema.parse(await readJson(response)).scores;
}

export async function exportRecordJson(recordId: string): Promise<ExportJob> {
  const response = await apiClient.request(apiV1.recordExport(recordId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ format: "json" }),
  });
  await expectOk(response, "export_failed");
  const body = (await readJson(response)) as { job: unknown };
  return exportJobSchema.parse(body.job);
}

export async function downloadExportBundle(downloadPath: string): Promise<RecordExportBundle> {
  const response = await apiClient.request(downloadPath);
  await expectOk(response, "export_download_failed");
  return recordExportBundleSchema.parse(await readJson(response));
}

export async function deleteHealthRecord(recordId: string): Promise<void> {
  const response = await apiClient.request(apiV1.record(recordId), { method: "DELETE" });
  if (response.status !== 204) {
    throw new Error("delete_failed");
  }
}

export async function deleteAllHealthRecords(): Promise<void> {
  const response = await apiClient.request(apiV1.records, { method: "DELETE" });
  await expectOk(response, "delete_all_failed");
}

export async function ensureRecordForVoice(): Promise<HealthRecord> {
  await grantRecordsConsent();
  const existing = await listHealthRecords();
  if (existing[0]) {
    return existing[0];
  }
  return createHealthRecord("Voice interview facts");
}
