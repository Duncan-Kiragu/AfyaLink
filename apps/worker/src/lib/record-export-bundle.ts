import {
  RECORDS_CONSENT_PURPOSE,
  RECORDS_CONSENT_VERSION,
  consentStatusSchema,
  healthRecordSchema,
  recordEntrySchema,
  recordExportBundleSchema,
  storedScoreSnapshotSchema,
  type RecordExportBundle,
  type RecordExportJob,
} from "@kkd/contracts";
import { createServiceRoleClient } from "./supabase.js";

const EXPORT_NOTICE =
  "This export contains patient-reported facts and process scores only. It does not contain a condition label or a predicted-condition score.";

export async function buildRecordExportBundle(job: RecordExportJob): Promise<RecordExportBundle | undefined> {
  const supabase = createServiceRoleClient();
  if (!supabase) {
    return undefined;
  }

  const { data: recordRow, error: recordError } = await supabase
    .from("health_records")
    .select("*")
    .eq("id", job.recordId)
    .eq("user_id", job.userId)
    .maybeSingle();
  if (recordError || !recordRow) {
    return undefined;
  }

  const [{ data: entryRows }, { data: scoreRows }, { data: consentRow }] = await Promise.all([
    supabase.from("health_record_entries").select("*").eq("record_id", job.recordId).eq("user_id", job.userId),
    supabase.from("score_snapshots").select("*").eq("record_id", job.recordId).eq("user_id", job.userId),
    supabase
      .from("consents")
      .select("*")
      .eq("user_id", job.userId)
      .eq("purpose", RECORDS_CONSENT_PURPOSE)
      .eq("version", RECORDS_CONSENT_VERSION)
      .is("withdrawn_at", null)
      .maybeSingle(),
  ]);

  const record = healthRecordSchema.parse({
    id: recordRow.id,
    userId: recordRow.user_id,
    label: recordRow.label ?? undefined,
    createdAt: recordRow.created_at,
  });

  const entries = (entryRows ?? []).map((row) =>
    recordEntrySchema.parse({
      id: row.id,
      userId: row.user_id,
      recordId: row.record_id,
      entryType: row.entry_type,
      conceptCode: row.concept_code ?? undefined,
      patientWording: row.patient_wording ?? undefined,
      valueJson: row.value_json ?? undefined,
      effectiveAt: row.effective_at,
      sourceChannel: row.source_channel,
      sourceSessionIdHash: row.source_session_id_hash ?? undefined,
      createdAt: row.created_at,
    }),
  );

  const scores = (scoreRows ?? []).map((row) =>
    storedScoreSnapshotSchema.parse({
      id: row.id,
      recordId: row.record_id,
      severityReported: row.severity_reported ?? undefined,
      urgencyClass: row.urgency_class,
      completenessPercent: row.completeness_percent,
      trajectory: row.trajectory,
      algorithmVersion: row.algorithm_version,
      generatedAt: row.generated_at,
      explanations: row.explanations,
    }),
  );

  const consent = consentRow
    ? consentStatusSchema.parse({
        purpose: RECORDS_CONSENT_PURPOSE,
        currentVersion: RECORDS_CONSENT_VERSION,
        granted: true,
        version: consentRow.version,
        grantedAt: consentRow.granted_at,
        withdrawnAt: consentRow.withdrawn_at ?? undefined,
      })
    : undefined;

  return recordExportBundleSchema.parse({
    exportedAt: new Date().toISOString(),
    notice: EXPORT_NOTICE,
    record,
    entries,
    scores,
    consent,
  });
}
