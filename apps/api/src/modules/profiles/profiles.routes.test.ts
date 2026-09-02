import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  PROFILE_CONSENT_VERSION,
  RECORDS_CONSENT_VERSION,
  type DueCheckIn,
} from "@kkd/contracts";
import { createApp } from "../../app.js";
import { resetRateLimit } from "../../middleware/rate-limit.js";
import { resetRecordStore } from "../records/records.store.js";
import { resetProfileStore } from "./profiles.store.js";

const app = createApp();
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function asUser(userId: string) {
  const header = { "x-kkd-user-id": userId };
  return {
    get: (url: string) => request(app).get(url).set(header),
    post: (url: string) => request(app).post(url).set(header),
    delete: (url: string) => request(app).delete(url).set(header),
  };
}

/** Both consents: Duncan's to store the answer, mine to ask the question. */
async function onboard(userId: string): Promise<string> {
  const records = await asUser(userId)
    .post("/api/v1/records/consent")
    .send({ version: RECORDS_CONSENT_VERSION });
  expect(records.status).toBe(201);

  const record = await asUser(userId).post("/api/v1/records").send({ label: "follow-up" });
  expect(record.status).toBe(201);

  const profile = await asUser(userId)
    .post("/api/v1/profile/consent")
    .send({ version: PROFILE_CONSENT_VERSION, channel: "web" });
  expect(profile.status).toBe(201);
  expect(profile.body.granted).toBe(true);

  return record.body.id as string;
}

/** Seeds a prior reported fact, so a check-in has something to follow up on. */
async function reportSymptom(
  userId: string,
  recordId: string,
  conceptCode: string,
  valueJson: Record<string, unknown>,
  effectiveAt: string,
) {
  const response = await asUser(userId)
    .post(`/api/v1/records/${recordId}/entries`)
    .send({
      entryType: "symptom",
      conceptCode,
      valueJson,
      effectiveAt,
      sourceChannel: "web",
    });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function createDailySchedule(userId: string, recordId: string) {
  const response = await asUser(userId)
    .post("/api/v1/profile/followups")
    .send({ recordId, cadence: { kind: "daily" } });
  expect(response.status).toBe(201);
  return response.body;
}

async function due(userId: string): Promise<DueCheckIn[]> {
  const response = await asUser(userId).get("/api/v1/profile/checkins/due");
  expect(response.status).toBe(200);
  return response.body.dueCheckIns as DueCheckIn[];
}

describe("health profiling HTTP (spec §8.4)", () => {
  const previousProfileFlag = process.env.FEATURE_HEALTH_PROFILE;
  const previousRecordsFlag = process.env.FEATURE_HEALTH_RECORDS;
  const previousDraftFlag = process.env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES;

  beforeEach(async () => {
    // This suite exercises many endpoints; without a reset the shared limiter window
    // carries over between tests and files.
    await resetRateLimit();
    process.env.FEATURE_HEALTH_PROFILE = "true";
    process.env.FEATURE_HEALTH_RECORDS = "true";
    // The shipped rule set is `draft`; without this every evaluation is `unknown`.
    process.env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES = "true";
    resetRecordStore();
    resetProfileStore();
  });

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };
    restore("FEATURE_HEALTH_PROFILE", previousProfileFlag);
    restore("FEATURE_HEALTH_RECORDS", previousRecordsFlag);
    restore("FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES", previousDraftFlag);
    resetRecordStore();
    resetProfileStore();
  });

  it("returns 404 when the feature flag is off", async () => {
    process.env.FEATURE_HEALTH_PROFILE = "false";
    const response = await asUser(USER_A).get("/api/v1/profile/consent");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("health_profile_disabled");
  });

  it("rejects anonymous access — profile data is never anonymous", async () => {
    const response = await request(app).get("/api/v1/profile/checkins/due");
    expect(response.status).toBe(401);
  });

  // --- §8.4.A consent ------------------------------------------------------

  it("shows what will be stored, contact frequency, channels and withdrawal before consent", async () => {
    const response = await asUser(USER_A).get("/api/v1/profile/consent");
    expect(response.status).toBe(200);
    expect(response.body.granted).toBe(false);
    expect(response.body.disclosure.storedDataKeys.length).toBeGreaterThan(0);
    expect(response.body.disclosure.maxContactsPerWeek).toBe(7);
    expect(response.body.disclosure.availableChannels).toEqual(["web"]);
    expect(response.body.disclosure.withdrawalKey).toBeTruthy();
    expect(response.body.disclosure.consentVersion).toBe(PROFILE_CONSENT_VERSION);
  });

  it("refuses a consent version other than the current disclosure", async () => {
    await asUser(USER_A).post("/api/v1/records/consent").send({ version: RECORDS_CONSENT_VERSION });
    const response = await asUser(USER_A)
      .post("/api/v1/profile/consent")
      .send({ version: "profile.checkins.v0", channel: "web" });
    expect(response.status).toBe(409);
  });

  it("refuses a channel that cannot deliver a check-in in V1", async () => {
    await asUser(USER_A).post("/api/v1/records/consent").send({ version: RECORDS_CONSENT_VERSION });
    const response = await asUser(USER_A)
      .post("/api/v1/profile/consent")
      .send({ version: PROFILE_CONSENT_VERSION, channel: "whatsapp" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("checkin_channel_not_available");
  });

  it("refuses check-in consent without consent to store the answers", async () => {
    const response = await asUser(USER_A)
      .post("/api/v1/profile/consent")
      .send({ version: PROFILE_CONSENT_VERSION, channel: "web" });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("consent_required");
  });

  it("creates no schedule without consent (spec §8.7)", async () => {
    await asUser(USER_A).post("/api/v1/records/consent").send({ version: RECORDS_CONSENT_VERSION });
    const record = await asUser(USER_A).post("/api/v1/records").send({ label: "no profile consent" });
    const response = await asUser(USER_A)
      .post("/api/v1/profile/followups")
      .send({ recordId: record.body.id, cadence: { kind: "daily" } });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("checkin_consent_not_granted");
  });

  // --- §8.4.B schedules ----------------------------------------------------

  it("creates daily, weekly and custom schedules and lists them", async () => {
    const recordId = await onboard(USER_A);
    for (const cadence of [
      { kind: "daily" },
      { kind: "weekly" },
      { kind: "custom_interval", intervalDays: 3 },
      { kind: "custom_once", dueAt: new Date(Date.now() + 86_400_000).toISOString() },
    ]) {
      const response = await asUser(USER_A)
        .post("/api/v1/profile/followups")
        .send({ recordId, cadence });
      expect(response.status).toBe(201);
      expect(response.body.status).toBe("active");
      expect(response.body.nextDueAt).toBeTruthy();
    }
    const list = await asUser(USER_A).get("/api/v1/profile/followups");
    expect(list.body.schedules).toHaveLength(4);
  });

  it("refuses a one-off check-in scheduled in the past", async () => {
    const recordId = await onboard(USER_A);
    const response = await asUser(USER_A)
      .post("/api/v1/profile/followups")
      .send({
        recordId,
        cadence: { kind: "custom_once", dueAt: "2020-01-01T00:00:00.000Z" },
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("schedule_has_no_future_occurrence");
  });

  it("deletes a schedule and refuses to delete another user's", async () => {
    const recordId = await onboard(USER_A);
    const schedule = await createDailySchedule(USER_A, recordId);
    await onboard(USER_B);

    const foreign = await asUser(USER_B).delete(`/api/v1/profile/followups/${schedule.id}`);
    expect(foreign.status).toBe(404);

    const deleted = await asUser(USER_A).delete(`/api/v1/profile/followups/${schedule.id}`);
    expect(deleted.status).toBe(204);
    const list = await asUser(USER_A).get("/api/v1/profile/followups");
    expect(list.body.schedules).toHaveLength(0);
  });

  it("does not let one user schedule against another user's record", async () => {
    const recordId = await onboard(USER_A);
    await onboard(USER_B);
    const response = await asUser(USER_B)
      .post("/api/v1/profile/followups")
      .send({ recordId, cadence: { kind: "daily" } });
    expect(response.status).toBe(404);
  });

  // --- §8.4.C due check-ins ------------------------------------------------

  it("builds due questions from previously reported facts, not a disease label", async () => {
    const recordId = await onboard(USER_A);
    await reportSymptom(USER_A, recordId, "abdominal_pain", { severity: 6 }, "2026-09-01T08:00:00.000Z");
    await createDailySchedule(USER_A, recordId);

    const dueCheckIns = await due(USER_A);
    expect(dueCheckIns).toHaveLength(1);
    const questions = dueCheckIns[0]?.questions ?? [];
    const severity = questions.find((question) => question.id === "abdominal_pain.severity");
    expect(severity?.questionKey).toBe("checkin.question.severity_now");
    expect(severity?.params).toMatchObject({ conceptCode: "abdominal_pain", previousSeverity: 6 });
    // i18n keys plus data — nothing patient-facing is rendered by the API.
    for (const question of questions) {
      expect(question.questionKey).toMatch(/^checkin\.question\./);
    }
  });

  // --- §8.4.E re-evaluation ------------------------------------------------

  it("re-runs the severity engine on every submitted answer (spec §8.4.E)", async () => {
    const recordId = await onboard(USER_A);
    await reportSymptom(USER_A, recordId, "abdominal_pain", { severity: 4 }, "2026-09-01T08:00:00.000Z");
    const schedule = await createDailySchedule(USER_A, recordId);
    const [dueCheckIn] = await due(USER_A);

    const response = await asUser(USER_A)
      .post(`/api/v1/profile/followups/${schedule.id}/checkins`)
      .send({
        occurrenceId: dueCheckIn?.occurrenceId,
        answeredAt: new Date().toISOString(),
        answers: [
          {
            questionId: "abdominal_pain.severity",
            questionKey: "checkin.question.severity_now",
            conceptCode: "abdominal_pain",
            value: 4,
          },
        ],
      });
    expect(response.status).toBe(201);
    expect(response.body.assessment.ruleSetVersion).toBeTruthy();
    expect(response.body.entries).toHaveLength(1);
    expect(response.body.entries[0].entryType).toBe("checkin");
    // The occurrence has been consumed: the same submission cannot be replayed.
    expect(response.body.schedule.nextDueAt).not.toBe(dueCheckIn?.dueAt);
  });

  /** §8.6: "worsening follow-up can trigger a higher urgency". */
  it("lets a worsening follow-up trigger a higher urgency", async () => {
    const recordId = await onboard(USER_A);
    await reportSymptom(USER_A, recordId, "abdominal_pain", { severity: 3 }, "2026-09-01T08:00:00.000Z");
    const schedule = await createDailySchedule(USER_A, recordId);

    const first = await due(USER_A);
    const mild = await asUser(USER_A)
      .post(`/api/v1/profile/followups/${schedule.id}/checkins`)
      .send({
        occurrenceId: first[0]?.occurrenceId,
        answeredAt: new Date().toISOString(),
        answers: [
          {
            questionId: "abdominal_pain.severity",
            questionKey: "checkin.question.severity_now",
            conceptCode: "abdominal_pain",
            value: 3,
          },
        ],
      });
    expect(mild.status).toBe(201);
    expect(mild.body.assessment.urgency).toBe("unknown");

    // The answered schedule is now a day out. A second schedule starting now is due
    // immediately, which is the next check-in for the same record.
    const worseSchedule = await asUser(USER_A)
      .post("/api/v1/profile/followups")
      .send({ recordId, cadence: { kind: "daily" } });
    expect(worseSchedule.status).toBe(201);
    const second = await due(USER_A);
    const worseDue = second.find(
      (dueCheckIn) => dueCheckIn.scheduleId === worseSchedule.body.id,
    );
    expect(worseDue).toBeDefined();

    const worse = await asUser(USER_A)
      .post(`/api/v1/profile/followups/${worseSchedule.body.id}/checkins`)
      .send({
        occurrenceId: worseDue?.occurrenceId,
        answeredAt: new Date().toISOString(),
        answers: [
          {
            questionId: "abdominal_pain.severity",
            questionKey: "checkin.question.severity_now",
            conceptCode: "abdominal_pain",
            value: 9,
          },
          {
            questionId: "abdominal_pain.change",
            questionKey: "checkin.question.change_since_last",
            conceptCode: "abdominal_pain",
            value: "worse",
          },
        ],
      });
    expect(worse.status).toBe(201);
    expect(worse.body.assessment.urgency).toBe("urgent_today");
    expect(worse.body.assessment.ruleIds).toContain("rf.severe_abdominal_pain_without_relief");
  });

  it("does not let a low-urgency history suppress a new red flag (spec §8.4.E)", async () => {
    const recordId = await onboard(USER_A);
    await reportSymptom(USER_A, recordId, "abdominal_pain", { severity: 2 }, "2026-09-01T08:00:00.000Z");
    const schedule = await createDailySchedule(USER_A, recordId);
    const [dueCheckIn] = await due(USER_A);

    const response = await asUser(USER_A)
      .post(`/api/v1/profile/followups/${schedule.id}/checkins`)
      .send({
        occurrenceId: dueCheckIn?.occurrenceId,
        answeredAt: new Date().toISOString(),
        answers: [
          {
            questionId: "chest_pain.present",
            questionKey: "checkin.question.still_present",
            conceptCode: "chest_pain",
            value: true,
          },
          {
            questionId: "breathlessness.present",
            questionKey: "checkin.question.still_present",
            conceptCode: "breathlessness",
            value: true,
          },
        ],
      });
    expect(response.status).toBe(201);
    expect(response.body.assessment.urgency).toBe("emergency");
    expect(response.body.assessment.requiresHumanEscalation).toBe(true);
  });

  it("refuses a stale or duplicate occurrence", async () => {
    const recordId = await onboard(USER_A);
    await reportSymptom(USER_A, recordId, "fever", { severity: 5 }, "2026-09-01T08:00:00.000Z");
    const schedule = await createDailySchedule(USER_A, recordId);
    const [dueCheckIn] = await due(USER_A);
    const body = {
      occurrenceId: dueCheckIn?.occurrenceId,
      answeredAt: new Date().toISOString(),
      answers: [
        {
          questionId: "fever.severity",
          questionKey: "checkin.question.severity_now",
          conceptCode: "fever",
          value: 5,
        },
      ],
    };
    expect((await asUser(USER_A).post(`/api/v1/profile/followups/${schedule.id}/checkins`).send(body)).status).toBe(201);
    const replay = await asUser(USER_A)
      .post(`/api/v1/profile/followups/${schedule.id}/checkins`)
      .send(body);
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe("occurrence_not_current");
  });

  // --- §8.4.D trends -------------------------------------------------------

  it("reports factual, non-diagnostic trends over stored observations", async () => {
    const recordId = await onboard(USER_A);
    await reportSymptom(USER_A, recordId, "abdominal_pain", { severity: 7 }, "2026-09-01T08:00:00.000Z");
    await reportSymptom(USER_A, recordId, "abdominal_pain", { severity: 6 }, "2026-09-02T08:00:00.000Z");
    await reportSymptom(USER_A, recordId, "abdominal_pain", { severity: 4 }, "2026-09-03T08:00:00.000Z");

    const response = await asUser(USER_A).get(`/api/v1/profile/trends?recordId=${recordId}`);
    expect(response.status).toBe(200);
    expect(response.body.suppressedCount).toBe(0);
    const severity = response.body.statements.find(
      (statement: { kind: string }) => statement.kind === "severity_change",
    );
    expect(severity.params).toMatchObject({
      conceptCode: "abdominal_pain",
      firstSeverity: 7,
      lastSeverity: 4,
      direction: "decreased",
    });
    expect(severity.observationIds).toHaveLength(3);
    for (const statement of response.body.statements) {
      expect(statement.statementKey).toMatch(/^trend\./);
    }
  });

  it("does not return another user's trends", async () => {
    const recordId = await onboard(USER_A);
    await onboard(USER_B);
    const response = await asUser(USER_B).get(`/api/v1/profile/trends?recordId=${recordId}`);
    expect(response.status).toBe(404);
  });

  // --- §8.6 consent withdrawal --------------------------------------------

  /** §8.6: "consent withdrawal stops future check-ins". */
  it("stops future check-ins the moment consent is withdrawn", async () => {
    const recordId = await onboard(USER_A);
    await reportSymptom(USER_A, recordId, "abdominal_pain", { severity: 6 }, "2026-09-01T08:00:00.000Z");
    const schedule = await createDailySchedule(USER_A, recordId);
    expect(await due(USER_A)).toHaveLength(1);

    const withdrawal = await asUser(USER_A).delete("/api/v1/profile/consent");
    expect(withdrawal.status).toBe(200);
    expect(withdrawal.body.granted).toBe(false);
    expect(withdrawal.body.withdrawnAt).toBeTruthy();

    // The due list refuses outright rather than returning an empty list by accident.
    const dueAfter = await asUser(USER_A).get("/api/v1/profile/checkins/due");
    expect(dueAfter.status).toBe(403);
    expect(dueAfter.body.error).toBe("checkin_consent_withdrawn");

    // The schedule itself is stopped, not merely filtered out of a query.
    const list = await asUser(USER_A).get("/api/v1/profile/followups");
    expect(list.body.schedules[0].status).toBe("withdrawn");
    expect(list.body.schedules[0].nextDueAt).toBeUndefined();

    // No new schedule, and no answer to an old one.
    const created = await asUser(USER_A)
      .post("/api/v1/profile/followups")
      .send({ recordId, cadence: { kind: "daily" } });
    expect(created.status).toBe(403);

    const submitted = await asUser(USER_A)
      .post(`/api/v1/profile/followups/${schedule.id}/checkins`)
      .send({
        occurrenceId: `${schedule.id}:${schedule.nextDueAt}`,
        answeredAt: new Date().toISOString(),
        answers: [
          {
            questionId: "abdominal_pain.severity",
            questionKey: "checkin.question.severity_now",
            conceptCode: "abdominal_pain",
            value: 6,
          },
        ],
      });
    expect(submitted.status).toBe(403);
  });

  it("lets a patient consent again after withdrawing, without reviving old schedules", async () => {
    const recordId = await onboard(USER_A);
    const schedule = await createDailySchedule(USER_A, recordId);
    await asUser(USER_A).delete("/api/v1/profile/consent");

    const regrant = await asUser(USER_A)
      .post("/api/v1/profile/consent")
      .send({ version: PROFILE_CONSENT_VERSION, channel: "web" });
    expect(regrant.status).toBe(201);
    expect(regrant.body.granted).toBe(true);

    const list = await asUser(USER_A).get("/api/v1/profile/followups");
    expect(list.body.schedules.find((row: { id: string }) => row.id === schedule.id).status).toBe(
      "withdrawn",
    );
    expect(await due(USER_A)).toHaveLength(0);
  });
});
