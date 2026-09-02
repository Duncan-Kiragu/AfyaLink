import { randomUUID } from "node:crypto";
import {
  buildCheckInQuestions,
  buildTrendStatements,
  checkInConsentDecision,
  completeOccurrence,
  currentCheckInDisclosure,
  evaluateCheckIn,
  firstDueAt,
  isDeliverableCheckInChannel,
  isDue,
  isRenderableConceptCode,
  isWithinDisclosedFrequency,
  observationsFromCheckInAnswers,
  occurrenceId,
  UnknownRuleSetVersionError,
  RED_FLAGS_V0_1_0_DRAFT_VERSION,
} from "@kkd/clinical-safety";
import {
  PROFILE_CONSENT_PURPOSE,
  PROFILE_CONSENT_VERSION,
  type Channel,
  type CheckInAnswer,
  type CheckInObservation,
  type CreateFollowUpScheduleInput,
  type DueCheckIn,
  type FollowUpSchedule,
  type PriorObservation,
  type ProfileConsentStatus,
  type RecordEntry,
  type RecordEntryInput,
  type SubmitCheckInInput,
  type SubmitCheckInResult,
  type TrendReport,
} from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import { assertSafeEvent, createLogger } from "@kkd/observability";
import { httpError } from "../../lib/http-error.js";
import {
  appendEntry,
  computeAndStoreScore,
  getRecord,
  listEntries,
  requireActiveConsent,
} from "../records/records.service.js";
import { getProfileStore, type ProfileStore } from "./profiles.store.js";

const log = createLogger("api.profiles");

/**
 * Health profiling service (spec §8.4).
 *
 * Sits on Duncan's record layer rather than beside it: check-in answers become
 * `health_record_entries` through `records.service.ts`, so his consent gate, his
 * ownership checks and his RLS apply to profiling data without being re-implemented.
 * What this module owns is the schedule, the permission to make contact, the questions,
 * the re-evaluation and the trends.
 *
 * Every function that needs the time takes it as an argument. The route supplies one
 * `now` per request, so a request is evaluated against a single instant and the domain
 * logic underneath stays a pure function of its inputs.
 */

function store(): ProfileStore {
  return getProfileStore();
}

/**
 * The rule set profiling evaluates against.
 *
 * Pinned to a constant rather than taken from the request: a patient must not be able to
 * choose which clinical rules judge their check-in. Same version for every user, and it
 * travels out on the assessment so a decision can be replayed (spec §8.7).
 */
const PROFILE_RULE_SET_VERSION = RED_FLAGS_V0_1_0_DRAFT_VERSION;

function severityOptions() {
  return {
    executeUnreviewedDraftRules: loadEnv().FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES,
  };
}

// ---------------------------------------------------------------------------
// Consent (spec §8.4.A)
// ---------------------------------------------------------------------------

/**
 * The gate every profiling path passes through.
 *
 * One function, called by schedule creation, the due list and answer intake alike, so a
 * withdrawal cannot close one door and leave another open (spec §8.6, "consent
 * withdrawal stops future check-ins").
 */
async function requireCheckInConsent(userId: string): Promise<Channel> {
  const decision = checkInConsentDecision(await store().getCheckInConsent(userId));
  if (!decision.allowed) {
    throw httpError(`checkin_consent_${decision.reason}`, 403);
  }
  return decision.channel;
}

export async function profileConsentStatus(userId: string): Promise<ProfileConsentStatus> {
  const consent = await store().getCheckInConsent(userId);
  const decision = checkInConsentDecision(consent);
  return {
    purpose: PROFILE_CONSENT_PURPOSE,
    currentVersion: PROFILE_CONSENT_VERSION,
    granted: decision.allowed,
    version: consent?.version,
    channel: consent?.channel,
    grantedAt: consent?.grantedAt,
    withdrawnAt: consent?.withdrawnAt,
    disclosure: currentCheckInDisclosure(),
  };
}

/**
 * Records consent to scheduled check-ins (spec §8.4.A).
 *
 * The version must be the current one: a client that has not seen the current
 * disclosure cannot consent to it. The channel must be one that can actually deliver,
 * so a stored preference is never a promise of contact the system cannot keep.
 */
export async function grantProfileConsent(
  userId: string,
  version: string,
  channel: Channel,
): Promise<ProfileConsentStatus> {
  if (version !== PROFILE_CONSENT_VERSION) {
    throw httpError("consent_version_mismatch", 409);
  }
  if (!isDeliverableCheckInChannel(channel)) {
    throw httpError("checkin_channel_not_available", 400);
  }
  // Storing check-in answers is Duncan's consent, not this one. Both are required:
  // this permits the question, his permits keeping the answer (spec §8.7).
  await requireActiveConsent(userId);

  const existing = await store().getCheckInConsent(userId);
  if (!existing || existing.withdrawnAt || existing.version !== version) {
    await store().grantCheckInConsent(userId, version, channel);
  }
  log.info(assertSafeEvent({ event: "checkin_consent_granted", status: version }));
  return profileConsentStatus(userId);
}

/**
 * Withdraws consent, and stops every future check-in in the same operation
 * (spec §8.4.A "allow withdrawal", §8.6 "consent withdrawal stops future check-ins").
 *
 * Schedules are withdrawn as well as consent, rather than relying on the consent check
 * alone. Two independent stops: the gate refuses, and there is nothing left to become
 * due. Neither depends on the other being remembered.
 */
export async function withdrawProfileConsent(userId: string): Promise<ProfileConsentStatus> {
  await store().withdrawCheckInConsent(userId);
  const stopped = await store().withdrawAllSchedules(userId);
  log.info(
    assertSafeEvent({ event: "checkin_consent_withdrawn", status: String(stopped) }),
  );
  return profileConsentStatus(userId);
}

// ---------------------------------------------------------------------------
// Schedules (spec §8.4.B)
// ---------------------------------------------------------------------------

export async function createFollowUpSchedule(
  userId: string,
  input: CreateFollowUpScheduleInput,
  now: string,
): Promise<FollowUpSchedule> {
  const consentChannel = await requireCheckInConsent(userId);
  // Ownership: `getRecord` throws 404 for a record that is not this user's.
  await getRecord(userId, input.recordId);

  const channel = input.channel ?? consentChannel;
  if (!isDeliverableCheckInChannel(channel)) {
    throw httpError("checkin_channel_not_available", 400);
  }
  if (!isWithinDisclosedFrequency(input.cadence)) {
    throw httpError("cadence_exceeds_disclosed_frequency", 400);
  }

  const startAt = input.startAt ?? now;
  const schedule: FollowUpSchedule = {
    id: randomUUID(),
    userId,
    recordId: input.recordId,
    cadence: input.cadence,
    status: "active",
    channel,
    consentVersion: PROFILE_CONSENT_VERSION,
    startAt,
    nextDueAt: firstDueAt(input.cadence, startAt, now),
    createdAt: now,
  };
  if (!schedule.nextDueAt) {
    // A one-off check-in in the past would be created and never deliverable.
    throw httpError("schedule_has_no_future_occurrence", 400);
  }

  const created = await store().createSchedule(schedule);
  log.info(
    assertSafeEvent({ event: "followup_schedule_created", status: created.cadence.kind }),
  );
  return created;
}

export async function listFollowUpSchedules(userId: string): Promise<FollowUpSchedule[]> {
  return store().listSchedules(userId);
}

/**
 * Deletes a schedule (spec §19, `DELETE /api/v1/profile/followups/:id`).
 *
 * A hard delete: the patient asked for the schedule to be gone, and §11 gives them
 * deletion rights over their own data. The check-in answers already recorded stay in
 * the health record — they are clinical history, not schedule metadata, and deleting
 * them is `DELETE /api/v1/records/:id`, which is Duncan's.
 */
export async function deleteFollowUpSchedule(userId: string, scheduleId: string): Promise<void> {
  const deleted = await store().deleteSchedule(userId, scheduleId);
  if (!deleted) {
    throw httpError("schedule_not_found", 404);
  }
  log.info(assertSafeEvent({ event: "followup_schedule_deleted", status: "ok" }));
}

// ---------------------------------------------------------------------------
// Due check-ins (spec §8.4.B, §8.4.C) — V1 delivery is in-app pull
// ---------------------------------------------------------------------------

/**
 * One stored record entry, projected into the flat shape the pure builders read.
 *
 * Reads only what a check-in or a symptom entry actually carries. An entry that settles
 * nothing yields `undefined` fields rather than defaults, so silence never becomes a
 * denial (spec §5.2).
 */
export function observationFromEntry(entry: RecordEntry): CheckInObservation | undefined {
  const conceptCode = entry.conceptCode;
  if (!conceptCode || !isRenderableConceptCode(conceptCode)) {
    return undefined;
  }
  const value = entry.valueJson ?? {};
  const severity =
    typeof value.severity === "number" && Number.isFinite(value.severity)
      ? value.severity
      : undefined;
  const present =
    typeof value.present === "boolean"
      ? value.present
      : severity !== undefined || entry.entryType === "symptom"
        ? true
        : undefined;
  const change = typeof value.change === "string" ? value.change : undefined;

  return {
    id: entry.id,
    observedAt: entry.effectiveAt,
    conceptCode,
    ...(severity === undefined ? {} : { severity }),
    ...(present === undefined ? {} : { present }),
    ...(change === undefined ? {} : { worseningReported: change === "worse" }),
  };
}

async function observationsForRecord(
  userId: string,
  recordId: string,
): Promise<CheckInObservation[]> {
  const entries = await listEntries(userId, recordId, {});
  return entries
    .map(observationFromEntry)
    .filter((observation): observation is CheckInObservation => observation !== undefined)
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
}

/**
 * Prior observations for the severity engine, one per check-in instant.
 *
 * Passed explicitly into evaluation rather than looked up inside it, so the engine stays
 * pure and a longitudinal decision can be replayed (spec §8.6).
 */
function priorObservationsFrom(observations: readonly CheckInObservation[]): PriorObservation[] {
  const byInstant = new Map<string, PriorObservation>();
  for (const observation of observations) {
    if (!observation.conceptCode || observation.present === false) {
      continue;
    }
    const existing = byInstant.get(observation.observedAt) ?? {
      observedAt: observation.observedAt,
      symptoms: [],
      facts: [],
    };
    existing.symptoms.push({
      id: `${observation.observedAt}.${observation.conceptCode}`,
      concept: observation.conceptCode,
      confidence: "explicit",
      ...(observation.severity === undefined ? {} : { severity: observation.severity }),
    });
    byInstant.set(observation.observedAt, existing);
  }
  return [...byInstant.values()].sort((left, right) =>
    left.observedAt.localeCompare(right.observedAt),
  );
}

/**
 * Check-ins the patient should see right now (spec §8.4.B).
 *
 * V1 delivery is in-app pull (`ws4-plan.md` §5 issue H): there is no SMS or WhatsApp
 * transport, both channels are Phase 2, and §2.1 forbids putting anything a patient must
 * act on into a queue. A patient opening the app is the delivery mechanism, and this is
 * the read that serves it.
 *
 * Consent is checked once, before any schedule is read, so a withdrawn patient gets an
 * empty list rather than a filtered one.
 */
export async function listDueCheckIns(userId: string, now: string): Promise<DueCheckIn[]> {
  await requireCheckInConsent(userId);
  const schedules = await store().listSchedules(userId);
  const due: DueCheckIn[] = [];

  for (const schedule of schedules) {
    if (!isDue(schedule, now) || !schedule.nextDueAt) {
      continue;
    }
    const observations = await observationsForRecord(userId, schedule.recordId);
    due.push({
      scheduleId: schedule.id,
      occurrenceId: occurrenceId(schedule.id, schedule.nextDueAt),
      dueAt: schedule.nextDueAt,
      recordId: schedule.recordId,
      channel: schedule.channel,
      questions: buildCheckInQuestions(observations),
    });
  }
  return due.sort((left, right) => left.dueAt.localeCompare(right.dueAt));
}

// ---------------------------------------------------------------------------
// Check-in intake, re-evaluation and trends (spec §8.4.C, §8.4.D, §8.4.E)
// ---------------------------------------------------------------------------

/** Answers for one concept, collapsed into a single record entry. */
function entriesFromAnswers(
  answers: readonly CheckInAnswer[],
  answeredAt: string,
  occurrence: string,
): RecordEntryInput[] {
  const byConcept = new Map<string, RecordEntryInput>();
  for (const answer of answers) {
    const conceptCode = answer.conceptCode;
    if (!conceptCode || !isRenderableConceptCode(conceptCode)) {
      // Refused rather than dropped: silently discarding a patient's answer would leave
      // them believing they had reported something that was never stored.
      throw httpError("answer_concept_required", 400);
    }
    const existing = byConcept.get(conceptCode) ?? {
      entryType: "checkin" as const,
      conceptCode,
      valueJson: { occurrenceId: occurrence } as Record<string, unknown>,
      effectiveAt: answeredAt,
      sourceChannel: "web" as const,
    };
    const valueJson = { ...(existing.valueJson ?? {}) };
    if (typeof answer.value === "number") {
      valueJson.severity = answer.value;
      valueJson.present = true;
    } else if (typeof answer.value === "boolean") {
      valueJson.present = answer.value;
    } else {
      valueJson.change = answer.value;
    }
    byConcept.set(conceptCode, { ...existing, valueJson });
  }
  return [...byConcept.values()];
}

/**
 * Accepts a check-in answer, re-runs the severity engine, and recomputes trends
 * (spec §8.4.C, §8.4.D, §8.4.E).
 *
 * Order matters and is deliberate:
 *
 * 1. consent, ownership and occurrence validity — nothing is written otherwise;
 * 2. answers are appended to the health record through Duncan's service, so his consent
 *    gate and ownership checks run on the write;
 * 3. the severity engine runs **synchronously**, on this check-in's facts, with the
 *    history alongside (spec §8.7, §2.1: urgency is never a job);
 * 4. the urgency is handed to Duncan's score layer — §6.4's handoff, urgency from my
 *    engine into his snapshot;
 * 5. the schedule advances past the occurrence just answered.
 *
 * The assessment is computed before the schedule advances and is returned whatever the
 * schedule does, so a patient reporting a red flag is told to seek care even if the
 * bookkeeping that follows fails.
 */
export async function submitCheckIn(
  userId: string,
  scheduleId: string,
  input: SubmitCheckInInput,
  requestId?: string,
): Promise<SubmitCheckInResult> {
  await requireCheckInConsent(userId);
  const schedule = await store().getSchedule(userId, scheduleId);
  if (!schedule) {
    throw httpError("schedule_not_found", 404);
  }
  if (schedule.status !== "active" || !schedule.nextDueAt) {
    throw httpError("schedule_not_active", 409);
  }
  // Idempotency (spec §4.G): the occurrence identifies which check-in is being answered.
  // A repeated submission names an occurrence that has already been advanced past, so it
  // is refused rather than recorded twice.
  if (input.occurrenceId !== occurrenceId(schedule.id, schedule.nextDueAt)) {
    throw httpError("occurrence_not_current", 409);
  }

  const priorObservations = await observationsForRecord(userId, schedule.recordId);

  const entries: RecordEntry[] = [];
  for (const entryInput of entriesFromAnswers(
    input.answers,
    input.answeredAt,
    input.occurrenceId,
  )) {
    entries.push(await appendEntry(userId, schedule.recordId, entryInput));
  }

  // §8.4.E. Nothing here consults the previous urgency; the engine decides from the
  // facts every time, so a profile of low-urgency check-ins cannot suppress a red flag.
  let evaluation;
  try {
    evaluation = evaluateCheckIn(
      {
        answers: input.answers,
        priorObservations: priorObservationsFrom(priorObservations),
        ruleSetVersion: PROFILE_RULE_SET_VERSION,
        answeredAt: input.answeredAt,
      },
      severityOptions(),
    );
  } catch (error) {
    if (error instanceof UnknownRuleSetVersionError) {
      throw httpError("unknown_rule_set_version", 500);
    }
    throw error;
  }
  const assessment = evaluation.assessment;

  log.info(
    assertSafeEvent({
      event: "checkin_evaluated",
      requestId,
      urgency: assessment.urgency,
      status: "ok",
    }),
  );
  for (const ruleId of assessment.ruleIds) {
    log.info(
      assertSafeEvent({
        event: "checkin_rule_fired",
        requestId,
        urgency: assessment.urgency,
        ruleId,
      }),
    );
  }

  // §6.4: urgency class from my engine into Duncan's snapshot. Best-effort — a score is
  // a derived view, and failing to store one must not withhold a disposition.
  try {
    await computeAndStoreScore(userId, schedule.recordId, {
      urgencyClass: assessment.urgency,
    });
  } catch {
    log.warn(
      assertSafeEvent({ event: "checkin_score_skipped", requestId, status: "error" }),
    );
  }

  const advanced = await store().putSchedule(
    completeOccurrence(schedule, input.answeredAt),
  );

  const answeredObservations = observationsFromCheckInAnswers(
    input.answers,
    input.answeredAt,
    (answer) =>
      entries.find((entry) => entry.conceptCode === answer.conceptCode)?.id ??
      `${input.occurrenceId}:${answer.questionId}`,
  );

  return {
    schedule: advanced,
    entries,
    assessment,
    trends: buildTrends(schedule.recordId, [...priorObservations, ...answeredObservations]),
  };
}

/**
 * Trend statements for a record (spec §8.4.D).
 *
 * Every statement is guard-checked before it leaves this function; refused ones are
 * counted, not returned (spec §8.6, "no diagnostic language in severity or trend
 * statements").
 */
function buildTrends(
  recordId: string,
  observations: readonly CheckInObservation[],
  locale = "en",
): TrendReport {
  const { statements, suppressed } = buildTrendStatements(observations, { locale });
  if (suppressed.length > 0) {
    for (const { patternIds } of suppressed) {
      for (const patternId of patternIds) {
        // Pattern id only. The offending span is patient-derived text (spec §18).
        log.warn(
          assertSafeEvent({
            event: "trend_statement_suppressed",
            status: patternId,
          }),
        );
      }
    }
  }
  return {
    recordId,
    statements: [...statements],
    suppressedCount: suppressed.length,
  };
}

export async function trendReport(
  userId: string,
  recordId: string,
  locale = "en",
): Promise<TrendReport> {
  await requireActiveConsent(userId);
  await getRecord(userId, recordId);
  return buildTrends(recordId, await observationsForRecord(userId, recordId), locale);
}

/** Exposed for the withdrawal path in tests and for the routes' 403 mapping. */
export { requireCheckInConsent };
