import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  RECORDS_CONSENT_PURPOSE,
  RECORDS_CONSENT_VERSION,
  consentStatusSchema,
  recordExportBundleSchema,
  type ComputeScoreInput,
  type ConsentStatus,
  type CreateRecordInput,
  type ExportFormat,
  type ExportJob,
  type HealthRecord,
  type PersistFactsInput,
  type PersistFactsResult,
  type RecordEntry,
  type RecordEntryInput,
  type RecordExportBundle,
  type RecordFilters,
  type StoredScoreSnapshot,
} from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import { createLogger } from "@kkd/observability";
import { DEFAULT_COMPLETENESS_FIELD_IDS, computeSystemScore } from "@kkd/scoring";
import { httpError } from "../../lib/http-error.js";
import { enqueueRecordJob } from "./records.queue.js";
import {
  comparablePointsFromEntries,
  deriveAnsweredFieldIds,
  factToEntryInput,
  getRecordStore,
  latestReportedSeverity,
  type RecordStore,
} from "./records.store.js";

const log = createLogger("records.service");

const LOCAL_EXPORT_SECRET = "local-records-export-dev-only";

function store(): RecordStore {
  return getRecordStore();
}

function requireUserId(userId: string | undefined): string {
  if (!userId) {
    throw httpError("unauthenticated", 401);
  }
  return userId;
}

export async function requireActiveConsent(userId: string): Promise<void> {
  const consent = await store().getConsent(userId);
  if (!consent || consent.version !== RECORDS_CONSENT_VERSION) {
    throw httpError("consent_required", 403);
  }
}

export async function consentStatus(userId: string): Promise<ConsentStatus> {
  const consent = await store().getConsent(requireUserId(userId));
  return consentStatusSchema.parse({
    purpose: RECORDS_CONSENT_PURPOSE,
    currentVersion: RECORDS_CONSENT_VERSION,
    granted: Boolean(consent && consent.version === RECORDS_CONSENT_VERSION),
    version: consent?.version,
    grantedAt: consent?.grantedAt,
    withdrawnAt: consent?.withdrawnAt,
  });
}

export async function grantConsent(userId: string, version: string): Promise<ConsentStatus> {
  requireUserId(userId);
  if (version !== RECORDS_CONSENT_VERSION) {
    throw httpError("consent_version_mismatch", 409);
  }
  const existing = await store().getConsent(userId);
  if (!existing) {
    await store().grantConsent(userId, version);
  }
  log.info({ event: "consent_granted", status: version });
  return consentStatus(userId);
}

export async function withdrawConsent(userId: string): Promise<ConsentStatus> {
  const status = await store().withdrawConsent(requireUserId(userId));
  log.info({ event: "consent_withdrawn", status: "ok" });
  return status;
}

export async function createRecord(userId: string, input: CreateRecordInput): Promise<HealthRecord> {
  requireUserId(userId);
  await requireActiveConsent(userId);
  const record = await store().createRecord(userId, input);
  if (record.userId !== userId) {
    throw httpError("record_ownership", 403);
  }
  log.info({ event: "record_created", status: "ok" });
  return record;
}

export async function listRecords(userId: string): Promise<HealthRecord[]> {
  return store().listRecords(requireUserId(userId));
}

export async function getRecord(userId: string, recordId: string): Promise<HealthRecord> {
  const record = await store().getRecord(requireUserId(userId), recordId);
  if (!record) {
    throw httpError("record_not_found", 404);
  }
  return record;
}

export async function appendEntry(
  userId: string,
  recordId: string,
  input: RecordEntryInput,
): Promise<RecordEntry> {
  requireUserId(userId);
  await requireActiveConsent(userId);
  assertValueJsonBudget(input.valueJson);
  const entry = await store().appendEntry(userId, recordId, input);
  if (!entry) {
    throw httpError("record_not_found", 404);
  }
  log.info({ event: "record_entry_appended", status: input.entryType });
  return entry;
}

export async function listEntries(
  userId: string,
  recordId: string,
  filters: RecordFilters,
): Promise<RecordEntry[]> {
  await getRecord(userId, recordId);
  return store().listEntries(userId, recordId, filters);
}

export async function persistSelectedFacts(
  userId: string,
  recordId: string,
  input: PersistFactsInput,
): Promise<PersistFactsResult> {
  requireUserId(userId);
  if (input.consentVersion !== RECORDS_CONSENT_VERSION) {
    throw httpError("consent_version_mismatch", 409);
  }
  await requireActiveConsent(userId);
  const record = await getRecord(userId, recordId);
  const sourceSessionIdHash = resolveSessionHash(input.sourceSessionId, input.sourceSessionIdHash);
  const entries: RecordEntry[] = [];
  for (const fact of input.facts) {
    assertValueJsonBudget(fact.valueJson);
    const entry = await store().appendEntry(
      userId,
      recordId,
      factToEntryInput(fact, input.sourceChannel, sourceSessionIdHash),
    );
    if (!entry) {
      throw httpError("record_not_found", 404);
    }
    entries.push(entry);
  }
  log.info({ event: "facts_persisted", status: String(entries.length) });
  return {
    record,
    entries,
    persistedCount: entries.length,
  };
}

export async function computeAndStoreScore(
  userId: string,
  recordId: string,
  input: ComputeScoreInput,
): Promise<StoredScoreSnapshot> {
  const record = await getRecord(userId, recordId);
  const entries = await store().listEntries(userId, record.id, {});
  const requiredFieldIds = input.requiredFieldIds ?? [...DEFAULT_COMPLETENESS_FIELD_IDS];
  const answeredFieldIds = input.answeredFieldIds ?? deriveAnsweredFieldIds(entries);
  const snapshot = computeSystemScore({
    urgencyClass: input.urgencyClass,
    requiredFieldIds,
    answeredFieldIds,
    inferredFieldIds: input.inferredFieldIds,
    severityReported: input.severityReported ?? latestReportedSeverity(entries),
    comparablePoints: comparablePointsFromEntries(entries),
  });
  const stored: StoredScoreSnapshot = {
    ...snapshot,
    id: randomUUID(),
    recordId: record.id,
  };
  await store().addScore(userId, record.id, stored);
  log.info({ event: "score_snapshot_created", status: stored.algorithmVersion, urgency: stored.urgencyClass });
  return stored;
}

export async function listScores(userId: string, recordId: string): Promise<StoredScoreSnapshot[]> {
  await getRecord(userId, recordId);
  return store().listScores(userId, recordId);
}

export async function exportRecord(
  userId: string,
  recordId: string,
  format: ExportFormat,
): Promise<ExportJob> {
  if (format === "pdf") {
    throw httpError("pdf_export_not_available", 400);
  }
  const record = await getRecord(userId, recordId);
  const [entries, scores, consent] = await Promise.all([
    store().listEntries(userId, recordId, {}),
    store().listScores(userId, recordId),
    consentStatus(userId),
  ]);
  const bundle = recordExportBundleSchema.parse({
    exportedAt: new Date().toISOString(),
    notice:
      "This export contains patient-reported facts and process scores only. It does not contain a condition label or a predicted-condition score.",
    record,
    entries,
    scores,
    consent,
  });
  assertNonDiagnosticBundle(bundle);

  const env = loadEnv();
  const ttlSeconds = env.RECORD_EXPORT_TTL_SECONDS;
  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  const jobId = randomUUID();
  const expiresAt = new Date(expiresAtMs).toISOString();
  const exp = Math.floor(expiresAtMs / 1000);
  const sig = signExportAccess(jobId, userId, exp);
  const job: ExportJob = {
    jobId,
    status: "completed",
    format: "json",
    expiresAt,
    downloadPath: `/api/v1/records/exports/${jobId}?exp=${exp}&sig=${sig}`,
  };
  await store().putExport({
    job,
    userId,
    recordId,
    bundleJson: JSON.stringify(bundle),
    expiresAtMs,
  });
  await enqueueRecordJob({
    kind: "record_export",
    idempotencyKey: `record-export:${jobId}`,
    jobId,
    recordId,
    userId,
    format: "json",
  });
  log.info({ event: "export_completed", status: "json" });
  return job;
}

export async function readExport(
  userId: string,
  jobId: string,
  exp?: string,
  sig?: string,
): Promise<RecordExportBundle> {
  const entry = await store().getExport(jobId);
  if (!entry || entry.userId !== userId) {
    throw httpError("export_not_found", 404);
  }
  if (exp && sig) {
    assertExportSignature(jobId, userId, exp, sig);
  }
  return recordExportBundleSchema.parse(JSON.parse(entry.bundleJson));
}

export async function deleteRecord(userId: string, recordId: string): Promise<void> {
  const deleted = await store().deleteRecord(requireUserId(userId), recordId);
  if (!deleted) {
    throw httpError("record_not_found", 404);
  }
  await enqueueRecordJob({
    kind: "record_purge_verify",
    idempotencyKey: `record-purge:${recordId}`,
    recordId,
    userId,
  });
  log.info({ event: "record_deleted", status: "ok" });
}

export async function deleteAllRecords(userId: string): Promise<number> {
  const count = await store().deleteAllRecords(requireUserId(userId));
  log.info({ event: "records_deleted_all", status: String(count) });
  return count;
}

function resolveSessionHash(sourceSessionId?: string, sourceSessionIdHash?: string): string | undefined {
  if (sourceSessionId) {
    return createHash("sha256").update(sourceSessionId).digest("hex");
  }
  return sourceSessionIdHash;
}

function assertValueJsonBudget(value: Record<string, unknown> | undefined): void {
  if (!value) {
    return;
  }
  if (JSON.stringify(value).length > 4000) {
    throw httpError("value_json_too_large", 400);
  }
}

function exportSigningSecret(): string {
  const env = loadEnv();
  if (env.RECORD_EXPORT_SIGNING_SECRET) {
    return env.RECORD_EXPORT_SIGNING_SECRET;
  }
  if (env.APP_ENV === "local" || env.NODE_ENV === "test") {
    return LOCAL_EXPORT_SECRET;
  }
  throw httpError("export_signing_unavailable", 503);
}

export function signExportAccess(jobId: string, userId: string, exp: number): string {
  return createHmac("sha256", exportSigningSecret()).update(`${jobId}.${userId}.${exp}`).digest("hex");
}

function assertExportSignature(jobId: string, userId: string, exp: string, sig: string): void {
  const expNumber = Number.parseInt(exp, 10);
  if (!Number.isFinite(expNumber) || expNumber * 1000 < Date.now()) {
    throw httpError("export_expired", 404);
  }
  const expected = signExportAccess(jobId, userId, expNumber);
  const expectedBuf = Buffer.from(expected, "hex");
  const givenBuf = Buffer.from(sig, "hex");
  if (expectedBuf.length !== givenBuf.length || !timingSafeEqual(expectedBuf, givenBuf)) {
    throw httpError("export_not_found", 404);
  }
}

function assertNonDiagnosticBundle(bundle: RecordExportBundle): void {
  const text = JSON.stringify(bundle);
  if (/\b(you may have|possible diagnosis|differential diagnosis|diseaseProbability)\b/i.test(text)) {
    throw httpError("diagnostic_export_forbidden", 500);
  }
}
