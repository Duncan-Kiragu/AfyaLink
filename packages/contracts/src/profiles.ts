import { z } from "zod";
import { channelSchema } from "./common.js";
import { recordEntrySchema } from "./records.js";
import { safetyAssessmentSchema } from "./safety.js";

/**
 * Health profiling — consent, follow-up schedules, check-ins and trends (spec §8.4).
 *
 * This file adds the *contact* half of profiling. It deliberately does not restate
 * anything in `records.ts`: check-in answers are Duncan's `RecordEntry` rows with
 * `entryType: "checkin"`, stored in his `health_records` layer under his consent
 * (`RECORDS_CONSENT_VERSION`). Spec §3.1 forbids a second model of the same thing, so
 * there is no separate check-in answer table and no separate patient record here.
 *
 * What is genuinely new is the permission to *contact* someone on a schedule, which
 * §8.4.A defines and which record-persistence consent does not cover.
 */

/**
 * Consent purpose for scheduled check-ins.
 *
 * A second purpose on Duncan's existing `consents` table, not a second consent model:
 * that table is already keyed `(user_id, purpose, version)`. Persisting facts and being
 * contacted on a schedule are different permissions — a patient may reasonably want a
 * record and no messages — and §8.4.A requires the second one to be shown and recorded
 * separately, with its own withdrawal.
 *
 * Profiling requires *both*: `RECORDS_CONSENT_VERSION` to store the answer and this to
 * ask the question.
 */
export const PROFILE_CONSENT_PURPOSE = "health_profile_checkins";
export const PROFILE_CONSENT_VERSION = "profile.checkins.v1";

/**
 * What a patient is shown before the first persistent check-in (spec §8.4.A).
 *
 * Keys, not sentences: reviewed wording is Brian's (spec §10.4.A) and no patient-facing
 * string ships from this repo until a clinical reviewer exists (`ws4-plan.md` §5 issue
 * F). The *shape* is what matters here — a consent version pins exactly which
 * disclosure was agreed to, so a later change to what is stored or how often KKD makes
 * contact forces a new version and a fresh grant.
 */
export const checkInConsentDisclosureSchema = z
  .object({
    consentVersion: z.string().min(1),
    purpose: z.literal(PROFILE_CONSENT_PURPOSE),
    /** i18n keys naming each category of data that will be stored. §8.4.A "show what will be stored". */
    storedDataKeys: z.array(z.string().min(1)).min(1),
    /** §8.4.A "show how often KKD will contact the user" — the ceiling any schedule is held to. */
    maxContactsPerWeek: z.number().int().positive(),
    /** §8.4.A "allow channel selection" — channels a patient may pick from. */
    availableChannels: z.array(channelSchema).min(1),
    /** i18n key for how to withdraw. §8.4.A "allow withdrawal". */
    withdrawalKey: z.string().min(1),
  })
  .strict();
export type CheckInConsentDisclosure = z.infer<typeof checkInConsentDisclosureSchema>;

/**
 * Channels that can actually deliver a check-in in V1 (`ws4-plan.md` §5 issue H).
 *
 * V1 delivery is in-app pull: a patient sees due check-ins when they open the app, on
 * the `web` channel. WhatsApp, USSD and voice are Phase 2 (spec §23) and there is no
 * SMS transport at all, so offering them at consent time would be a promise of contact
 * the system cannot keep.
 */
export const V1_DELIVERABLE_CHECK_IN_CHANNELS = ["web"] as const;

export const CHECK_IN_CONSENT_DISCLOSURE: CheckInConsentDisclosure =
  checkInConsentDisclosureSchema.parse({
    consentVersion: PROFILE_CONSENT_VERSION,
    purpose: PROFILE_CONSENT_PURPOSE,
    storedDataKeys: [
      "profile.consent.stored.reported_symptoms",
      "profile.consent.stored.severity_ratings",
      "profile.consent.stored.checkin_answers",
      "profile.consent.stored.checkin_schedule",
      "profile.consent.stored.urgency_outcomes",
    ],
    // Ceiling for the most frequent cadence §8.4.B allows (daily), so the number shown
    // at consent time bounds every schedule that consent can license.
    maxContactsPerWeek: 7,
    availableChannels: [...V1_DELIVERABLE_CHECK_IN_CHANNELS],
    withdrawalKey: "profile.consent.withdraw",
  });

export const grantProfileConsentInputSchema = z
  .object({
    version: z.string().min(1),
    /** §8.4.A channel selection. Rejected unless deliverable in V1. */
    channel: channelSchema,
  })
  .strict();
export type GrantProfileConsentInput = z.infer<typeof grantProfileConsentInputSchema>;

export const profileConsentStatusSchema = z
  .object({
    purpose: z.literal(PROFILE_CONSENT_PURPOSE),
    currentVersion: z.literal(PROFILE_CONSENT_VERSION),
    granted: z.boolean(),
    version: z.string().optional(),
    channel: channelSchema.optional(),
    grantedAt: z.string().optional(),
    withdrawnAt: z.string().optional(),
    /** Always returned, granted or not, so the consent screen is renderable from one call. */
    disclosure: checkInConsentDisclosureSchema,
  })
  .strict();
export type ProfileConsentStatus = z.infer<typeof profileConsentStatusSchema>;

/**
 * Follow-up cadence (spec §8.4.B: "daily / weekly / custom future check-in").
 *
 * `custom_interval` and `custom_once` are the two readings of "custom": repeat every N
 * days, or a single check-in at a chosen instant. Both are supported because the spec
 * line is ambiguous and each is cheap.
 *
 * Intervals are exact durations, not calendar arithmetic: "daily" is every 24 hours.
 * V1 has no per-user timezone, so a local-time-of-day cadence would be a guess.
 */
export const followUpCadenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily") }).strict(),
  z.object({ kind: z.literal("weekly") }).strict(),
  z
    .object({
      kind: z.literal("custom_interval"),
      intervalDays: z.number().int().min(1).max(90),
    })
    .strict(),
  z.object({ kind: z.literal("custom_once"), dueAt: z.string().min(1) }).strict(),
]);
export type FollowUpCadence = z.infer<typeof followUpCadenceSchema>;

/**
 * `withdrawn` is terminal and is set when consent is withdrawn (spec §8.6, "consent
 * withdrawal stops future check-ins"). `completed` is the natural end of a
 * `custom_once` schedule. Neither ever becomes due again.
 */
export const followUpScheduleStatusSchema = z.enum(["active", "withdrawn", "completed"]);
export type FollowUpScheduleStatus = z.infer<typeof followUpScheduleStatusSchema>;

export const followUpScheduleSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    /** The health record check-in answers are appended to. Duncan's `health_records`. */
    recordId: z.string().uuid(),
    cadence: followUpCadenceSchema,
    status: followUpScheduleStatusSchema,
    channel: channelSchema,
    /** Consent version in force when the schedule was created. */
    consentVersion: z.string().min(1),
    /** Anchor for interval arithmetic. Occurrences fall on `startAt + n * interval`. */
    startAt: z.string().min(1),
    /**
     * The next occurrence, or absent when the schedule will never be due again.
     *
     * Persisted rather than recomputed on read so that a schedule row is auditable on
     * its own (spec §8.4.B: "store the source schedule persistently"), but it is always
     * a value the pure `nextDueAt` produced from the cadence — never an independent
     * source of truth.
     */
    nextDueAt: z.string().optional(),
    lastCompletedAt: z.string().optional(),
    createdAt: z.string(),
  })
  .strict();
export type FollowUpSchedule = z.infer<typeof followUpScheduleSchema>;

export const createFollowUpScheduleInputSchema = z
  .object({
    recordId: z.string().uuid(),
    cadence: followUpCadenceSchema,
    /** Defaults to the channel recorded at consent. */
    channel: channelSchema.optional(),
    /** Defaults to the moment the schedule is created. */
    startAt: z.string().min(1).optional(),
  })
  .strict();
export type CreateFollowUpScheduleInput = z.infer<typeof createFollowUpScheduleInputSchema>;

export const followUpScheduleListSchema = z.object({
  schedules: z.array(followUpScheduleSchema),
});
export type FollowUpScheduleList = z.infer<typeof followUpScheduleListSchema>;

/**
 * The shape of answer a check-in question expects, so a channel can render an input and
 * the intake can validate one without parsing free text.
 *
 * `worse_same_better` is the patient's own comparison with the previous check-in. It is
 * what licenses §8.4.D's "marked as worsening for two consecutive check-ins": a
 * statement about what the patient said, not an inference from severity numbers.
 */
export const checkInAnswerShapeSchema = z.enum([
  "severity_0_10",
  "yes_no",
  "worse_same_better",
  "text",
]);
export type CheckInAnswerShape = z.infer<typeof checkInAnswerShapeSchema>;

/**
 * One check-in question (spec §8.4.C).
 *
 * Key plus data, never a rendered sentence, and never a disease label: `params` carries
 * only values taken from what the patient previously reported (a concept code, a prior
 * severity rating, when they reported it). §8.4.C: "based on previously reported facts,
 * not a disease label".
 */
export const checkInQuestionSchema = z
  .object({
    /** Stable within an occurrence, so an answer can name the question it answers. */
    id: z.string().min(1),
    questionKey: z.string().min(1),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    answerShape: checkInAnswerShapeSchema,
    /** Concept the question is about, when it is about one. Always patient-reported. */
    conceptCode: z.string().optional(),
    /** Record entries this question was derived from — the "previously reported facts". */
    sourceEntryIds: z.array(z.string()),
  })
  .strict();
export type CheckInQuestion = z.infer<typeof checkInQuestionSchema>;

export const dueCheckInSchema = z
  .object({
    scheduleId: z.string().uuid(),
    /**
     * Identity of this occurrence: `<scheduleId>:<dueAt>`.
     *
     * Derived, not stored. It is the idempotency key for an answer (spec §4.G) and it
     * makes a late answer to a superseded occurrence detectable without an occurrence
     * table.
     */
    occurrenceId: z.string().min(1),
    dueAt: z.string().min(1),
    recordId: z.string().uuid(),
    channel: channelSchema,
    questions: z.array(checkInQuestionSchema),
  })
  .strict();
export type DueCheckIn = z.infer<typeof dueCheckInSchema>;

export const dueCheckInListSchema = z.object({
  dueCheckIns: z.array(dueCheckInSchema),
});
export type DueCheckInList = z.infer<typeof dueCheckInListSchema>;

export const checkInAnswerSchema = z
  .object({
    questionId: z.string().min(1),
    questionKey: z.string().min(1),
    conceptCode: z.string().max(80).optional(),
    value: z.union([z.number(), z.boolean(), z.string().max(2000)]),
  })
  .strict();
export type CheckInAnswer = z.infer<typeof checkInAnswerSchema>;

export const submitCheckInInputSchema = z
  .object({
    occurrenceId: z.string().min(1),
    answeredAt: z.string().min(1),
    answers: z.array(checkInAnswerSchema).min(1).max(20),
  })
  .strict();
export type SubmitCheckInInput = z.infer<typeof submitCheckInInputSchema>;

/**
 * A factual trend statement (spec §8.4.D).
 *
 * Key plus data again, for the same reason as a check-in question, plus one more: the
 * only part of a trend sentence that is not reviewed copy is the interpolated data, so
 * that is exactly where a disease label could enter a patient-facing surface. The
 * builder runs `params` through the diagnosis-language guard before emitting.
 */
export const trendStatementKindSchema = z.enum([
  /** A rated severity moved between the first and last comparable check-in. */
  "severity_change",
  /** A symptom was reported on N of the last M check-ins. */
  "report_frequency",
  /** The patient marked a symptom worse on consecutive check-ins. */
  "consecutive_worsening",
]);
export type TrendStatementKind = z.infer<typeof trendStatementKindSchema>;

export const trendStatementSchema = z
  .object({
    kind: trendStatementKindSchema,
    statementKey: z.string().min(1),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    /** Every observation the statement was computed from. §8.7 auditability. */
    observationIds: z.array(z.string()).min(1),
  })
  .strict();
export type TrendStatement = z.infer<typeof trendStatementSchema>;

export const trendReportSchema = z
  .object({
    recordId: z.string().uuid(),
    statements: z.array(trendStatementSchema),
    /**
     * Statements the diagnosis-language guard refused, by kind.
     *
     * Reported rather than silently dropped: a refusal means patient-reported data
     * carried a condition label, which a reviewer needs to see (spec §14).
     */
    suppressedCount: z.number().int().nonnegative(),
  })
  .strict();
export type TrendReport = z.infer<typeof trendReportSchema>;

export const submitCheckInResultSchema = z
  .object({
    schedule: followUpScheduleSchema,
    entries: z.array(recordEntrySchema),
    /**
     * The severity engine re-run on this check-in plus every prior one (spec §8.4.E).
     * Synchronous, and never filtered by earlier low-urgency outcomes.
     */
    assessment: safetyAssessmentSchema,
    trends: trendReportSchema,
  })
  .strict();
export type SubmitCheckInResult = z.infer<typeof submitCheckInResultSchema>;

export const scheduleIdParamsSchema = z.object({
  id: z.string().uuid(),
});
export type ScheduleIdParams = z.infer<typeof scheduleIdParamsSchema>;

export const trendQuerySchema = z.object({
  recordId: z.string().uuid(),
  locale: z.string().min(2).default("en"),
});
export type TrendQuery = z.infer<typeof trendQuerySchema>;

/**
 * One stored check-in datum, flattened for the pure trend and question builders.
 *
 * Mapped from Duncan's `RecordEntry` at the API boundary rather than passed as a
 * `RecordEntry`, so `@kkd/clinical-safety` computes trends over a shape it owns and
 * stays free of the storage layer. It is a projection of his rows, not a second copy of
 * them: nothing here is persisted.
 */
export const checkInObservationSchema = z
  .object({
    /** The originating `RecordEntry.id`. Carried into `TrendStatement.observationIds`. */
    id: z.string().min(1),
    observedAt: z.string().min(1),
    /** Patient-reported concept, e.g. `abdominal_pain`. Never a condition label. */
    conceptCode: z.string().optional(),
    /** Present when the patient rated intensity 0-10. */
    severity: z.number().min(0).max(10).optional(),
    /** True when the concept was reported present at this observation, false when denied. */
    present: z.boolean().optional(),
    /** True when the patient marked this concept as worse than last time. */
    worseningReported: z.boolean().optional(),
  })
  .strict();
export type CheckInObservation = z.infer<typeof checkInObservationSchema>;
