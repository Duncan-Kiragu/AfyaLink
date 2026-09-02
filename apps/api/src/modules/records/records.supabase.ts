import type {
  ConsentRecord,
  ConsentStatus,
  CreateRecordInput,
  HealthRecord,
  RecordEntry,
  RecordEntryInput,
  RecordFilters,
  StoredScoreSnapshot,
} from "@kkd/contracts";
import {
  RECORDS_CONSENT_PURPOSE,
  RECORDS_CONSENT_VERSION,
  consentRecordSchema,
  healthRecordSchema,
  recordEntrySchema,
  storedScoreSnapshotSchema,
} from "@kkd/contracts";
import { httpError } from "../../lib/http-error.js";
import { createServiceRoleClient } from "../../lib/supabase.js";
import type { ExportCacheEntry, RecordStore } from "./records.store.js";

const exportCache = new Map<string, ExportCacheEntry>();

function client() {
  const supabase = createServiceRoleClient();
  if (!supabase) {
    throw httpError("persistence_unavailable", 503);
  }
  return supabase;
}

function mapRecord(row: Record<string, unknown>): HealthRecord {
  return healthRecordSchema.parse({
    id: row.id,
    userId: row.user_id,
    label: row.label ?? undefined,
    createdAt: row.created_at,
  });
}

function mapEntry(row: Record<string, unknown>): RecordEntry {
  return recordEntrySchema.parse({
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
  });
}

function mapConsent(row: Record<string, unknown>): ConsentRecord {
  return consentRecordSchema.parse({
    id: row.id,
    userId: row.user_id,
    version: row.version,
    purpose: row.purpose,
    grantedAt: row.granted_at,
    withdrawnAt: row.withdrawn_at ?? undefined,
  });
}

function mapScore(row: Record<string, unknown>): StoredScoreSnapshot {
  return storedScoreSnapshotSchema.parse({
    id: row.id,
    recordId: row.record_id,
    severityReported: row.severity_reported ?? undefined,
    urgencyClass: row.urgency_class,
    completenessPercent: row.completeness_percent,
    trajectory: row.trajectory,
    algorithmVersion: row.algorithm_version,
    generatedAt: row.generated_at,
    explanations: row.explanations,
  });
}

async function insertSideTables(entry: RecordEntry): Promise<void> {
  const supabase = client();
  const value = entry.valueJson ?? {};
  if (entry.entryType === "measurement" && typeof value.name === "string" && typeof value.value === "string") {
    const { error } = await supabase.from("measurements").insert({
      user_id: entry.userId,
      record_id: entry.recordId,
      entry_id: entry.id,
      name: value.name,
      value: value.value,
      unit: typeof value.unit === "string" ? value.unit : null,
      effective_at: entry.effectiveAt,
    });
    if (error) {
      throw httpError("measurement_write_failed", 503);
    }
  }
  if (entry.entryType === "medication_report" && (typeof value.name === "string" || entry.patientWording)) {
    const { error } = await supabase.from("reported_medications").insert({
      user_id: entry.userId,
      record_id: entry.recordId,
      entry_id: entry.id,
      name: typeof value.name === "string" ? value.name : (entry.patientWording ?? "unspecified"),
      patient_wording: entry.patientWording ?? null,
      effective_at: entry.effectiveAt,
    });
    if (error) {
      throw httpError("medication_write_failed", 503);
    }
  }
}

export const supabaseRecordStore: RecordStore = {
  async createRecord(userId, input: CreateRecordInput) {
    const { data, error } = await client()
      .from("health_records")
      .insert({ user_id: userId, label: input.label ?? null })
      .select()
      .single();
    if (error || !data) {
      throw httpError("record_create_failed", 503);
    }
    return mapRecord(data);
  },

  async listRecords(userId) {
    const { data, error } = await client()
      .from("health_records")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) {
      throw httpError("record_list_failed", 503);
    }
    return (data ?? []).map((row) => mapRecord(row));
  },

  async getRecord(userId, recordId) {
    const { data, error } = await client()
      .from("health_records")
      .select("*")
      .eq("id", recordId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      throw httpError("record_read_failed", 503);
    }
    return data ? mapRecord(data) : undefined;
  },

  async deleteRecord(userId, recordId) {
    const existing = await this.getRecord(userId, recordId);
    if (!existing) {
      return false;
    }
    const { error } = await client()
      .from("health_records")
      .delete()
      .eq("id", recordId)
      .eq("user_id", userId);
    if (error) {
      throw httpError("record_delete_failed", 503);
    }
    await this.deleteExportsForRecord(recordId);
    return true;
  },

  async deleteAllRecords(userId) {
    const owned = await this.listRecords(userId);
    const { error } = await client().from("health_records").delete().eq("user_id", userId);
    if (error) {
      throw httpError("record_delete_failed", 503);
    }
    for (const record of owned) {
      await this.deleteExportsForRecord(record.id);
    }
    return owned.length;
  },

  async appendEntry(userId, recordId, input: RecordEntryInput) {
    const record = await this.getRecord(userId, recordId);
    if (!record) {
      return undefined;
    }
    const { data, error } = await client()
      .from("health_record_entries")
      .insert({
        user_id: userId,
        record_id: recordId,
        entry_type: input.entryType,
        concept_code: input.conceptCode ?? null,
        patient_wording: input.patientWording ?? null,
        value_json: input.valueJson ?? {},
        effective_at: input.effectiveAt,
        source_channel: input.sourceChannel,
        source_session_id_hash: input.sourceSessionIdHash ?? null,
      })
      .select()
      .single();
    if (error || !data) {
      throw httpError("entry_write_failed", 503);
    }
    const entry = mapEntry(data);
    await insertSideTables(entry);
    return entry;
  },

  async listEntries(userId, recordId, filters: RecordFilters) {
    const record = await this.getRecord(userId, recordId);
    if (!record) {
      return [];
    }
    let query = client()
      .from("health_record_entries")
      .select("*")
      .eq("user_id", userId)
      .eq("record_id", recordId)
      .order("effective_at", { ascending: true });
    if (filters.entryType) {
      query = query.eq("entry_type", filters.entryType);
    }
    if (filters.from) {
      query = query.gte("effective_at", filters.from);
    }
    if (filters.to) {
      query = query.lte("effective_at", filters.to);
    }
    const { data, error } = await query;
    if (error) {
      throw httpError("entry_list_failed", 503);
    }
    return (data ?? []).map((row) => mapEntry(row));
  },

  async addScore(userId, recordId, snapshot) {
    const record = await this.getRecord(userId, recordId);
    if (!record) {
      throw httpError("record_not_found", 404);
    }
    const { data, error } = await client()
      .from("score_snapshots")
      .insert({
        id: snapshot.id,
        user_id: userId,
        record_id: recordId,
        severity_reported: snapshot.severityReported ?? null,
        urgency_class: snapshot.urgencyClass,
        completeness_percent: snapshot.completenessPercent,
        trajectory: snapshot.trajectory,
        algorithm_version: snapshot.algorithmVersion,
        explanations: snapshot.explanations,
        generated_at: snapshot.generatedAt,
      })
      .select()
      .single();
    if (error || !data) {
      throw httpError("score_write_failed", 503);
    }
    return mapScore(data);
  },

  async listScores(userId, recordId) {
    const record = await this.getRecord(userId, recordId);
    if (!record) {
      return [];
    }
    const { data, error } = await client()
      .from("score_snapshots")
      .select("*")
      .eq("user_id", userId)
      .eq("record_id", recordId)
      .order("generated_at", { ascending: true });
    if (error) {
      throw httpError("score_list_failed", 503);
    }
    return (data ?? []).map((row) => mapScore(row));
  },

  async getConsent(userId) {
    const { data, error } = await client()
      .from("consents")
      .select("*")
      .eq("user_id", userId)
      .eq("purpose", RECORDS_CONSENT_PURPOSE)
      .is("withdrawn_at", null)
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw httpError("consent_read_failed", 503);
    }
    return data ? mapConsent(data) : undefined;
  },

  async grantConsent(userId, version) {
    const { data, error } = await client()
      .from("consents")
      .insert({
        user_id: userId,
        version,
        purpose: RECORDS_CONSENT_PURPOSE,
      })
      .select()
      .single();
    if (error || !data) {
      throw httpError("consent_write_failed", 503);
    }
    return mapConsent(data);
  },

  async withdrawConsent(userId): Promise<ConsentStatus> {
    const existing = await this.getConsent(userId);
    const withdrawnAt = new Date().toISOString();
    if (existing) {
      const { error } = await client()
        .from("consents")
        .update({ withdrawn_at: withdrawnAt })
        .eq("id", existing.id)
        .eq("user_id", userId);
      if (error) {
        throw httpError("consent_write_failed", 503);
      }
    }
    return {
      purpose: RECORDS_CONSENT_PURPOSE,
      currentVersion: RECORDS_CONSENT_VERSION,
      granted: false,
      version: existing?.version,
      grantedAt: existing?.grantedAt,
      withdrawnAt: existing ? withdrawnAt : undefined,
    };
  },

  async putExport(entry) {
    exportCache.set(entry.job.jobId, entry);
    await client().from("record_exports").insert({
      id: entry.job.jobId,
      user_id: entry.userId,
      record_id: entry.recordId,
      format: "json",
      status: entry.job.status,
      expires_at: entry.job.expiresAt ?? null,
    });
  },

  async getExport(jobId) {
    const entry = exportCache.get(jobId);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAtMs < Date.now()) {
      exportCache.delete(jobId);
      return undefined;
    }
    return entry;
  },

  async deleteExportsForRecord(recordId) {
    for (const [id, entry] of exportCache) {
      if (entry.recordId === recordId) {
        exportCache.delete(id);
      }
    }
  },
};
