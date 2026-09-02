import { randomUUID } from "node:crypto";
import type {
  ConsentRecord,
  ConsentStatus,
  CreateRecordInput,
  ExportJob,
  HealthRecord,
  PersistableFact,
  RecordEntry,
  RecordEntryInput,
  RecordFilters,
  StoredScoreSnapshot,
} from "@kkd/contracts";
import {
  RECORDS_CONSENT_PURPOSE,
  RECORDS_CONSENT_VERSION,
} from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import { createServiceRoleClient } from "../../lib/supabase.js";
import { supabaseRecordStore } from "./records.supabase.js";

export type ExportCacheEntry = {
  job: ExportJob;
  userId: string;
  recordId: string;
  bundleJson: string;
  expiresAtMs: number;
};

export interface RecordStore {
  createRecord(userId: string, input: CreateRecordInput): Promise<HealthRecord>;
  listRecords(userId: string): Promise<HealthRecord[]>;
  getRecord(userId: string, recordId: string): Promise<HealthRecord | undefined>;
  deleteRecord(userId: string, recordId: string): Promise<boolean>;
  deleteAllRecords(userId: string): Promise<number>;
  appendEntry(userId: string, recordId: string, input: RecordEntryInput): Promise<RecordEntry | undefined>;
  listEntries(userId: string, recordId: string, filters: RecordFilters): Promise<RecordEntry[]>;
  addScore(userId: string, recordId: string, snapshot: StoredScoreSnapshot): Promise<StoredScoreSnapshot>;
  listScores(userId: string, recordId: string): Promise<StoredScoreSnapshot[]>;
  getConsent(userId: string): Promise<ConsentRecord | undefined>;
  grantConsent(userId: string, version: string): Promise<ConsentRecord>;
  withdrawConsent(userId: string): Promise<ConsentStatus>;
  putExport(entry: ExportCacheEntry): Promise<void>;
  getExport(jobId: string): Promise<ExportCacheEntry | undefined>;
  deleteExportsForRecord(recordId: string): Promise<void>;
}

type MemoryState = {
  records: Map<string, HealthRecord>;
  entries: Map<string, RecordEntry>;
  scores: Map<string, StoredScoreSnapshot>;
  consents: Map<string, ConsentRecord>;
  exports: Map<string, ExportCacheEntry>;
};

const memory: MemoryState = {
  records: new Map(),
  entries: new Map(),
  scores: new Map(),
  consents: new Map(),
  exports: new Map(),
};

export function resetRecordStore(): void {
  memory.records.clear();
  memory.entries.clear();
  memory.scores.clear();
  memory.consents.clear();
  memory.exports.clear();
}

function nowIso(): string {
  return new Date().toISOString();
}

export const memoryRecordStore: RecordStore = {
  async createRecord(userId, input) {
    const record: HealthRecord = {
      id: randomUUID(),
      userId,
      label: input.label,
      createdAt: nowIso(),
    };
    memory.records.set(record.id, record);
    return record;
  },

  async listRecords(userId) {
    return [...memory.records.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async getRecord(userId, recordId) {
    const record = memory.records.get(recordId);
    if (!record || record.userId !== userId) {
      return undefined;
    }
    return record;
  },

  async deleteRecord(userId, recordId) {
    const record = memory.records.get(recordId);
    if (!record || record.userId !== userId) {
      return false;
    }
    memory.records.delete(recordId);
    for (const [id, entry] of memory.entries) {
      if (entry.recordId === recordId) {
        memory.entries.delete(id);
      }
    }
    for (const [id, score] of memory.scores) {
      if (score.recordId === recordId) {
        memory.scores.delete(id);
      }
    }
    await this.deleteExportsForRecord(recordId);
    return true;
  },

  async deleteAllRecords(userId) {
    const owned = [...memory.records.values()].filter((record) => record.userId === userId);
    for (const record of owned) {
      await this.deleteRecord(userId, record.id);
    }
    return owned.length;
  },

  async appendEntry(userId, recordId, input) {
    const record = await this.getRecord(userId, recordId);
    if (!record) {
      return undefined;
    }
    const entry: RecordEntry = {
      id: randomUUID(),
      userId,
      recordId,
      entryType: input.entryType,
      conceptCode: input.conceptCode,
      patientWording: input.patientWording,
      valueJson: input.valueJson,
      effectiveAt: input.effectiveAt,
      sourceChannel: input.sourceChannel,
      sourceSessionIdHash: input.sourceSessionIdHash,
      createdAt: nowIso(),
    };
    memory.entries.set(entry.id, entry);
    return entry;
  },

  async listEntries(userId, recordId, filters) {
    const record = await this.getRecord(userId, recordId);
    if (!record) {
      return [];
    }
    return [...memory.entries.values()]
      .filter((entry) => entry.userId === userId && entry.recordId === recordId)
      .filter((entry) => (filters.entryType ? entry.entryType === filters.entryType : true))
      .filter((entry) => (filters.from ? entry.effectiveAt >= filters.from : true))
      .filter((entry) => (filters.to ? entry.effectiveAt <= filters.to : true))
      .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt));
  },

  async addScore(userId, recordId, snapshot) {
    const record = await this.getRecord(userId, recordId);
    if (!record) {
      throw Object.assign(new Error("record_not_found"), { statusCode: 404 });
    }
    memory.scores.set(snapshot.id, snapshot);
    return snapshot;
  },

  async listScores(userId, recordId) {
    const record = await this.getRecord(userId, recordId);
    if (!record) {
      return [];
    }
    return [...memory.scores.values()]
      .filter((score) => score.recordId === recordId)
      .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  },

  async getConsent(userId) {
    const row = memory.consents.get(userId);
    if (!row || row.withdrawnAt) {
      return undefined;
    }
    return row;
  },

  async grantConsent(userId, version) {
    const row: ConsentRecord = {
      id: randomUUID(),
      userId,
      version,
      purpose: RECORDS_CONSENT_PURPOSE,
      grantedAt: nowIso(),
    };
    memory.consents.set(userId, row);
    return row;
  },

  async withdrawConsent(userId) {
    const existing = memory.consents.get(userId);
    const withdrawnAt = nowIso();
    if (existing && !existing.withdrawnAt) {
      memory.consents.set(userId, { ...existing, withdrawnAt });
    }
    return {
      purpose: RECORDS_CONSENT_PURPOSE,
      currentVersion: RECORDS_CONSENT_VERSION,
      granted: false,
      version: existing?.version,
      grantedAt: existing?.grantedAt,
      withdrawnAt: existing?.withdrawnAt ?? withdrawnAt,
    };
  },

  async putExport(entry) {
    memory.exports.set(entry.job.jobId, entry);
  },

  async getExport(jobId) {
    const entry = memory.exports.get(jobId);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAtMs < Date.now()) {
      memory.exports.delete(jobId);
      return undefined;
    }
    return entry;
  },

  async deleteExportsForRecord(recordId) {
    for (const [id, entry] of memory.exports) {
      if (entry.recordId === recordId) {
        memory.exports.delete(id);
      }
    }
  },
};

export function getRecordStore(): RecordStore {
  if (process.env.NODE_ENV === "test") {
    return memoryRecordStore;
  }
  const env = loadEnv();
  const supabaseReady = Boolean(
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && createServiceRoleClient(),
  );
  const wantLiveSupabase = process.env.KKD_RECORDS_STORE === "supabase";
  if (env.APP_ENV === "local" && !wantLiveSupabase) {
    return memoryRecordStore;
  }
  if (supabaseReady) {
    return supabaseRecordStore;
  }
  if (env.APP_ENV === "local") {
    return memoryRecordStore;
  }
  throw Object.assign(new Error("persistence_unavailable"), { statusCode: 503 });
}

export function factToEntryInput(
  fact: PersistableFact,
  sourceChannel: RecordEntryInput["sourceChannel"],
  sourceSessionIdHash?: string,
): RecordEntryInput {
  const valueJson = {
    ...(fact.valueJson ?? {}),
    confidence: fact.confidence,
  };
  return {
    entryType: fact.entryType,
    conceptCode: fact.conceptCode,
    patientWording: fact.patientWording,
    valueJson,
    effectiveAt: fact.effectiveAt,
    sourceChannel,
    sourceSessionIdHash,
  };
}

export function deriveAnsweredFieldIds(entries: RecordEntry[]): string[] {
  const answered = new Set<string>();
  for (const entry of entries) {
    const confidence = readConfidence(entry);
    if (confidence === undefined) {
      continue;
    }
    if (entry.conceptCode) {
      answered.add(entry.conceptCode);
    }
    if (entry.entryType === "symptom" && entry.patientWording) {
      answered.add("primary_experience");
    }
    const value = entry.valueJson ?? {};
    if (hasNumber(value.severity) || entry.conceptCode === "severity") {
      answered.add("severity");
    }
    if (typeof value.onset === "string" || typeof value.duration === "string") {
      answered.add("onset_or_duration");
    }
    if (typeof value.location === "string") {
      answered.add("location");
    }
    if (Array.isArray(value.associatedSymptoms) || Array.isArray(value.deniedSymptoms)) {
      answered.add("associated_or_denied");
    }
  }
  return [...answered];
}

export function latestReportedSeverity(entries: RecordEntry[]): number | undefined {
  const rated = entries
    .map((entry) => {
      const severity = entry.valueJson?.severity;
      return hasNumber(severity) ? { at: entry.effectiveAt, severity } : undefined;
    })
    .filter((item): item is { at: string; severity: number } => item !== undefined)
    .sort((a, b) => a.at.localeCompare(b.at));
  return rated[rated.length - 1]?.severity;
}

export function comparablePointsFromEntries(entries: RecordEntry[]): Array<{
  effectiveAt: string;
  severityReported?: number;
}> {
  return entries
    .map((entry) => {
      const severity = entry.valueJson?.severity;
      return hasNumber(severity)
        ? { effectiveAt: entry.effectiveAt, severityReported: severity }
        : undefined;
    })
    .filter((item): item is { effectiveAt: string; severityReported: number } => item !== undefined);
}

function readConfidence(entry: RecordEntry): string | undefined {
  const value = entry.valueJson?.confidence;
  return typeof value === "string" ? value : "explicit";
}

function hasNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
