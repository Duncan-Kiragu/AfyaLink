import type { FollowUpCadence, FollowUpSchedule } from "@kkd/contracts";

/**
 * Follow-up schedule arithmetic (spec §8.4.B).
 *
 * Every function here takes the clock as a parameter. Nothing calls `Date.now()`, and
 * nothing reads the system clock indirectly — a due-date computation that reads a
 * hidden clock cannot be tested for the §8.6 criteria, and "is this check-in due?" is
 * on the same synchronous path as an urgency decision.
 *
 * Instants are ISO-8601 strings at the boundary and epoch milliseconds inside. Intervals
 * are exact durations: "daily" is 24 hours, not "the same local time tomorrow". V1
 * stores no per-user timezone, so calendar arithmetic would be inventing one.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export class InvalidInstantError extends Error {
  constructor(readonly value: string) {
    super(`Not a valid ISO-8601 instant: ${value}`);
    this.name = "InvalidInstantError";
  }
}

/** Parses an instant, refusing anything unparseable rather than yielding `NaN`. */
export function parseInstant(value: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new InvalidInstantError(value);
  }
  return ms;
}

export function toInstant(ms: number): string {
  return new Date(ms).toISOString();
}

/** Interval length in milliseconds, or `undefined` for a non-repeating cadence. */
export function cadenceIntervalMs(cadence: FollowUpCadence): number | undefined {
  switch (cadence.kind) {
    case "daily":
      return DAY_MS;
    case "weekly":
      return 7 * DAY_MS;
    case "custom_interval":
      return cadence.intervalDays * DAY_MS;
    case "custom_once":
      return undefined;
  }
}

/**
 * The first occurrence strictly after `after`, or `undefined` when the cadence has no
 * further occurrence.
 *
 * Pure: `startAt` anchors the series and `after` is the supplied clock reading. The same
 * three arguments always give the same answer, so a schedule's next-due can be replayed
 * from its stored row alone.
 *
 * Occurrences fall on `startAt + n * interval` for whole `n >= 0`. Anchoring on
 * `startAt` rather than on the last answer means a late answer does not drag the whole
 * series later, and a missed occurrence is skipped rather than queued up — a patient
 * returning after a week away sees one due check-in, not seven.
 */
export function nextDueAt(
  cadence: FollowUpCadence,
  startAt: string,
  after: string,
): string | undefined {
  const afterMs = parseInstant(after);

  if (cadence.kind === "custom_once") {
    const dueMs = parseInstant(cadence.dueAt);
    return dueMs > afterMs ? toInstant(dueMs) : undefined;
  }

  const startMs = parseInstant(startAt);
  const intervalMs = cadenceIntervalMs(cadence);
  if (intervalMs === undefined || intervalMs <= 0) {
    return undefined;
  }
  if (startMs > afterMs) {
    return toInstant(startMs);
  }
  const elapsed = afterMs - startMs;
  const occurrences = Math.floor(elapsed / intervalMs) + 1;
  return toInstant(startMs + occurrences * intervalMs);
}

/**
 * The first occurrence at or after `at`, used when a schedule is created.
 *
 * A schedule starting now is due now: the patient asked for a check-in and there is no
 * reason to make them wait one full interval before the first one.
 */
export function firstDueAt(cadence: FollowUpCadence, startAt: string, at: string): string | undefined {
  if (cadence.kind === "custom_once") {
    const dueMs = parseInstant(cadence.dueAt);
    return dueMs >= parseInstant(at) ? toInstant(dueMs) : undefined;
  }
  const startMs = parseInstant(startAt);
  const atMs = parseInstant(at);
  if (startMs >= atMs) {
    return toInstant(startMs);
  }
  return nextDueAt(cadence, startAt, toInstant(atMs - 1));
}

/**
 * Whether a schedule has an occurrence the patient should see now (spec §8.4.B).
 *
 * Consent is *not* checked here — it is checked by the caller, once, for every path at
 * the same time. A schedule whose status is `withdrawn` or `completed` is never due,
 * whatever its `nextDueAt` says.
 */
export function isDue(schedule: FollowUpSchedule, now: string): boolean {
  if (schedule.status !== "active" || !schedule.nextDueAt) {
    return false;
  }
  return parseInstant(schedule.nextDueAt) <= parseInstant(now);
}

/** Occurrence identity: stable, derived, and usable as an idempotency key (spec §4.G). */
export function occurrenceId(scheduleId: string, dueAt: string): string {
  return `${scheduleId}:${toInstant(parseInstant(dueAt))}`;
}

/**
 * Moves a schedule past the occurrence just answered.
 *
 * A repeating schedule gets its next occurrence after `answeredAt`; a `custom_once`
 * schedule is `completed` and never becomes due again. Returns a new schedule — nothing
 * here mutates.
 */
export function completeOccurrence(
  schedule: FollowUpSchedule,
  answeredAt: string,
): FollowUpSchedule {
  const next = nextDueAt(schedule.cadence, schedule.startAt, answeredAt);
  return {
    ...schedule,
    lastCompletedAt: answeredAt,
    status: next ? schedule.status : "completed",
    ...(next ? { nextDueAt: next } : { nextDueAt: undefined }),
  };
}

/**
 * Stops a schedule permanently (spec §8.6, "consent withdrawal stops future check-ins").
 *
 * `nextDueAt` is cleared as well as the status changed. Either alone would stop the due
 * list; both together mean a row cannot be revived by a status edit or by a due-date
 * query that forgets to filter on status.
 */
export function withdrawSchedule(schedule: FollowUpSchedule): FollowUpSchedule {
  return { ...schedule, status: "withdrawn", nextDueAt: undefined };
}
