import { randomUUID } from "node:crypto";
import {
  PROFILE_CONSENT_PURPOSE,
  followUpScheduleSchema,
  type Channel,
  type FollowUpSchedule,
} from "@kkd/contracts";
import type { CheckInConsentState } from "@kkd/clinical-safety";
import { loadEnv } from "@kkd/config";
import { httpError } from "../../lib/http-error.js";
import { createServiceRoleClient } from "../../lib/supabase.js";

/**
 * Storage for follow-up schedules and check-in contact consent.
 *
 * Two backends behind one interface, mirroring `records.store.ts` so the profiling
 * module has the same in-memory/Supabase switch as the record layer it sits on.
 *
 * Check-in *answers* are not stored here. They are appended to Duncan's
 * `health_record_entries` through `records.service.ts`, under his consent and his RLS
 * (spec §3.1: no second model of the same thing). What this store owns is the schedule
 * and the permission to make contact — neither of which his layer models.
 */

export interface ProfileStore {
  /** The check-in consent row, withdrawn or not. Withdrawal state is the caller's to read. */
  getCheckInConsent(userId: string): Promise<CheckInConsentState | undefined>;
  grantCheckInConsent(
    userId: string,
    version: string,
    channel: Channel,
  ): Promise<CheckInConsentState>;
  withdrawCheckInConsent(userId: string): Promise<CheckInConsentState | undefined>;
  createSchedule(schedule: FollowUpSchedule): Promise<FollowUpSchedule>;
  listSchedules(userId: string): Promise<FollowUpSchedule[]>;
  getSchedule(userId: string, scheduleId: string): Promise<FollowUpSchedule | undefined>;
  putSchedule(schedule: FollowUpSchedule): Promise<FollowUpSchedule>;
  deleteSchedule(userId: string, scheduleId: string): Promise<boolean>;
  /** Used by consent withdrawal to stop every future check-in at once. */
  withdrawAllSchedules(userId: string): Promise<number>;
}

type ConsentRow = CheckInConsentState & { id: string; userId: string };

type MemoryState = {
  consents: Map<string, ConsentRow>;
  schedules: Map<string, FollowUpSchedule>;
};

const memory: MemoryState = {
  consents: new Map(),
  schedules: new Map(),
};

export function resetProfileStore(): void {
  memory.consents.clear();
  memory.schedules.clear();
}

function nowIso(): string {
  return new Date().toISOString();
}

export const memoryProfileStore: ProfileStore = {
  async getCheckInConsent(userId) {
    return memory.consents.get(userId);
  },

  async grantCheckInConsent(userId, version, channel) {
    const row: ConsentRow = {
      id: randomUUID(),
      userId,
      version,
      channel,
      grantedAt: nowIso(),
    };
    memory.consents.set(userId, row);
    return row;
  },

  async withdrawCheckInConsent(userId) {
    const existing = memory.consents.get(userId);
    if (!existing || existing.withdrawnAt) {
      return existing;
    }
    const withdrawn = { ...existing, withdrawnAt: nowIso() };
    memory.consents.set(userId, withdrawn);
    return withdrawn;
  },

  async createSchedule(schedule) {
    memory.schedules.set(schedule.id, schedule);
    return schedule;
  },

  async listSchedules(userId) {
    return [...memory.schedules.values()]
      .filter((schedule) => schedule.userId === userId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  },

  async getSchedule(userId, scheduleId) {
    const schedule = memory.schedules.get(scheduleId);
    if (!schedule || schedule.userId !== userId) {
      return undefined;
    }
    return schedule;
  },

  async putSchedule(schedule) {
    memory.schedules.set(schedule.id, schedule);
    return schedule;
  },

  async deleteSchedule(userId, scheduleId) {
    const schedule = memory.schedules.get(scheduleId);
    if (!schedule || schedule.userId !== userId) {
      return false;
    }
    memory.schedules.delete(scheduleId);
    return true;
  },

  async withdrawAllSchedules(userId) {
    let count = 0;
    for (const [id, schedule] of memory.schedules) {
      if (schedule.userId !== userId || schedule.status !== "active") {
        continue;
      }
      memory.schedules.set(id, { ...schedule, status: "withdrawn", nextDueAt: undefined });
      count += 1;
    }
    return count;
  },
};

function client() {
  const supabase = createServiceRoleClient();
  if (!supabase) {
    throw httpError("persistence_unavailable", 503);
  }
  return supabase;
}

function mapSchedule(row: Record<string, unknown>): FollowUpSchedule {
  return followUpScheduleSchema.parse({
    id: row.id,
    userId: row.user_id,
    recordId: row.record_id,
    cadence: row.cadence,
    status: row.status,
    channel: row.channel,
    consentVersion: row.consent_version,
    startAt: row.start_at,
    nextDueAt: row.next_due_at ?? undefined,
    lastCompletedAt: row.last_completed_at ?? undefined,
    createdAt: row.created_at,
  });
}

function scheduleRow(schedule: FollowUpSchedule): Record<string, unknown> {
  return {
    id: schedule.id,
    user_id: schedule.userId,
    record_id: schedule.recordId,
    cadence_kind: schedule.cadence.kind,
    cadence: schedule.cadence,
    status: schedule.status,
    channel: schedule.channel,
    consent_version: schedule.consentVersion,
    start_at: schedule.startAt,
    next_due_at: schedule.nextDueAt ?? null,
    last_completed_at: schedule.lastCompletedAt ?? null,
    created_at: schedule.createdAt,
  };
}

export const supabaseProfileStore: ProfileStore = {
  async getCheckInConsent(userId) {
    // The latest row for this purpose, withdrawn or not: the caller needs to tell
    // "never granted" from "granted then withdrawn" (spec §8.4.A).
    const { data, error } = await client()
      .from("consents")
      .select("*")
      .eq("user_id", userId)
      .eq("purpose", PROFILE_CONSENT_PURPOSE)
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw httpError("consent_read_failed", 503);
    }
    if (!data) {
      return undefined;
    }
    const { data: settings } = await client()
      .from("health_profile_settings")
      .select("channel")
      .eq("user_id", userId)
      .maybeSingle();
    return {
      version: String(data.version),
      channel: (settings?.channel as Channel | undefined) ?? undefined,
      grantedAt: data.granted_at ? String(data.granted_at) : undefined,
      withdrawnAt: data.withdrawn_at ? String(data.withdrawn_at) : undefined,
    };
  },

  async grantCheckInConsent(userId, version, channel) {
    const supabase = client();
    const { data, error } = await supabase
      .from("consents")
      .insert({ user_id: userId, version, purpose: PROFILE_CONSENT_PURPOSE })
      .select()
      .single();
    if (error || !data) {
      throw httpError("consent_write_failed", 503);
    }
    const { error: settingsError } = await supabase
      .from("health_profile_settings")
      .upsert(
        {
          user_id: userId,
          channel,
          consent_version: version,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (settingsError) {
      throw httpError("profile_settings_write_failed", 503);
    }
    return {
      version,
      channel,
      grantedAt: data.granted_at ? String(data.granted_at) : new Date().toISOString(),
    };
  },

  async withdrawCheckInConsent(userId) {
    const supabase = client();
    const withdrawnAt = new Date().toISOString();
    const { error } = await supabase
      .from("consents")
      .update({ withdrawn_at: withdrawnAt })
      .eq("user_id", userId)
      .eq("purpose", PROFILE_CONSENT_PURPOSE)
      .is("withdrawn_at", null);
    if (error) {
      throw httpError("consent_write_failed", 503);
    }
    return this.getCheckInConsent(userId);
  },

  async createSchedule(schedule) {
    const { data, error } = await client()
      .from("follow_up_schedules")
      .insert(scheduleRow(schedule))
      .select()
      .single();
    if (error || !data) {
      throw httpError("schedule_write_failed", 503);
    }
    return mapSchedule(data);
  },

  async listSchedules(userId) {
    const { data, error } = await client()
      .from("follow_up_schedules")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) {
      throw httpError("schedule_read_failed", 503);
    }
    return (data ?? []).map(mapSchedule);
  },

  async getSchedule(userId, scheduleId) {
    const { data, error } = await client()
      .from("follow_up_schedules")
      .select("*")
      .eq("user_id", userId)
      .eq("id", scheduleId)
      .maybeSingle();
    if (error) {
      throw httpError("schedule_read_failed", 503);
    }
    return data ? mapSchedule(data) : undefined;
  },

  async putSchedule(schedule) {
    const { data, error } = await client()
      .from("follow_up_schedules")
      .update(scheduleRow(schedule))
      .eq("id", schedule.id)
      .eq("user_id", schedule.userId)
      .select()
      .single();
    if (error || !data) {
      throw httpError("schedule_write_failed", 503);
    }
    return mapSchedule(data);
  },

  async deleteSchedule(userId, scheduleId) {
    const { data, error } = await client()
      .from("follow_up_schedules")
      .delete()
      .eq("id", scheduleId)
      .eq("user_id", userId)
      .select("id");
    if (error) {
      throw httpError("schedule_write_failed", 503);
    }
    return (data ?? []).length > 0;
  },

  async withdrawAllSchedules(userId) {
    const { data, error } = await client()
      .from("follow_up_schedules")
      .update({ status: "withdrawn", next_due_at: null })
      .eq("user_id", userId)
      .eq("status", "active")
      .select("id");
    if (error) {
      throw httpError("schedule_write_failed", 503);
    }
    return (data ?? []).length;
  },
};

export function getProfileStore(): ProfileStore {
  if (process.env.NODE_ENV === "test") {
    return memoryProfileStore;
  }
  const env = loadEnv();
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && createServiceRoleClient()) {
    return supabaseProfileStore;
  }
  if (env.APP_ENV === "local") {
    return memoryProfileStore;
  }
  throw httpError("persistence_unavailable", 503);
}
