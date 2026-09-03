import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { RECORDS_CONSENT_VERSION } from "@kkd/contracts";
import { createApp } from "../../app.js";
import { acknowledgeDisclosure, createVoiceSession, submitAnswer } from "../voice/voice.service.js";
import { resetVoiceSessions } from "../voice/voice.store.js";
import { resetRecordStore } from "./records.store.js";

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

async function grantConsent(userId: string) {
  const response = await asUser(userId)
    .post("/api/v1/records/consent")
    .send({ version: RECORDS_CONSENT_VERSION });
  expect(response.status).toBe(201);
  expect(response.body.granted).toBe(true);
}

async function createOwnedRecord(userId: string, label = "abdominal symptoms") {
  await grantConsent(userId);
  const created = await asUser(userId).post("/api/v1/records").send({ label });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

describe("health records HTTP", () => {
  const previousFlag = process.env.FEATURE_HEALTH_RECORDS;

  beforeEach(() => {
    process.env.FEATURE_HEALTH_RECORDS = "true";
    resetRecordStore();
    resetVoiceSessions();
  });

  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env.FEATURE_HEALTH_RECORDS;
    } else {
      process.env.FEATURE_HEALTH_RECORDS = previousFlag;
    }
    resetRecordStore();
    resetVoiceSessions();
  });

  it("returns 404 when the feature flag is off", async () => {
    process.env.FEATURE_HEALTH_RECORDS = "false";
    const response = await asUser(USER_A).get("/api/v1/records");
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("health_records_disabled");
  });

  it("rejects anonymous access", async () => {
    const response = await request(app).get("/api/v1/records");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("unauthenticated");
  });

  it("does not persist without consent", async () => {
    const created = await asUser(USER_A).post("/api/v1/records").send({ label: "no consent" });
    expect(created.status).toBe(403);
    expect(created.body.error).toBe("consent_required");
  });

  it("lets user A create, persist selected facts, score, export, and delete", async () => {
    const recordId = await createOwnedRecord(USER_A);

    const persist = await asUser(USER_A)
      .post(`/api/v1/records/${recordId}/persist`)
      .send({
        consentVersion: RECORDS_CONSENT_VERSION,
        sourceChannel: "web",
        sourceSessionId: "ephemeral-session-not-stored",
        facts: [
          {
            entryType: "symptom",
            conceptCode: "primary_experience",
            patientWording: "Abdominal pain began approximately eight hours ago",
            valueJson: { location: "lower-right abdomen", severity: 7, confidence: "explicit" },
            effectiveAt: "2026-09-02T04:00:00.000Z",
            confidence: "explicit",
          },
          {
            entryType: "symptom",
            conceptCode: "onset_or_duration",
            patientWording: "Started about eight hours ago",
            valueJson: { onset: "eight hours ago" },
            effectiveAt: "2026-09-02T04:00:00.000Z",
            confidence: "explicit",
          },
        ],
      });
    expect(persist.status).toBe(201);
    expect(persist.body.persistedCount).toBe(2);
    expect(JSON.stringify(persist.body)).not.toContain("ephemeral-session-not-stored");

    const entries = await asUser(USER_A).get(`/api/v1/records/${recordId}/entries`);
    expect(entries.status).toBe(200);
    expect(entries.body.entries).toHaveLength(2);

    const scored = await asUser(USER_A)
      .post(`/api/v1/records/${recordId}/scores`)
      .send({});
    expect(scored.status).toBe(201);
    expect(scored.body.score.urgencyClass).toBe("unknown");
    expect(scored.body.score.completenessPercent).toBeGreaterThan(0);
    expect(scored.body.score.trajectory).toBe("insufficient_data");
    expect(scored.body.score).not.toHaveProperty("diseaseProbability");
    expect(JSON.stringify(scored.body.score)).not.toMatch(/malaria|appendicitis|diagnosis/i);

    const history = await asUser(USER_A).get(`/api/v1/records/${recordId}/scores`);
    expect(history.body.scores).toHaveLength(1);

    const exported = await asUser(USER_A)
      .post(`/api/v1/records/${recordId}/export`)
      .send({ format: "json" });
    expect(exported.status).toBe(201);
    expect(exported.body.job.status).toBe("completed");
    expect(exported.body.job.downloadPath).toMatch(/\/api\/v1\/records\/exports\//);

    const download = await asUser(USER_A).get(exported.body.job.downloadPath);
    expect(download.status).toBe(200);
    expect(download.body.entries).toHaveLength(2);
    expect(download.body.notice).toContain("does not contain a condition label");

    const pdf = await asUser(USER_A)
      .post(`/api/v1/records/${recordId}/export`)
      .send({ format: "pdf" });
    expect(pdf.status).toBe(400);

    const removed = await asUser(USER_A).delete(`/api/v1/records/${recordId}`);
    expect(removed.status).toBe(204);
    const missing = await asUser(USER_A).get(`/api/v1/records/${recordId}`);
    expect(missing.status).toBe(404);
  });

  it("hides user A records from user B", async () => {
    const recordId = await createOwnedRecord(USER_A);
    const peek = await asUser(USER_B).get(`/api/v1/records/${recordId}`);
    expect(peek.status).toBe(404);
    const write = await asUser(USER_B)
      .post(`/api/v1/records/${recordId}/entries`)
      .send({
        entryType: "note",
        patientWording: "should not land",
        effectiveAt: "2026-09-02T12:00:00.000Z",
        sourceChannel: "web",
      });
    expect(write.status).toBeGreaterThanOrEqual(400);
    const list = await asUser(USER_B).get("/api/v1/records");
    expect(list.body.records).toEqual([]);
  });

  it("does not expose a diagnosis-score route", async () => {
    const missing = await asUser(USER_A).get("/api/v1/diagnosis-score");
    expect(missing.status).toBe(404);
    const scores = await asUser(USER_A).get("/api/v1/scores");
    expect(scores.status).toBe(404);
    expect(scores.body.path).toBe("/api/v1/records/:id/scores");
  });

  it("rejects persist after consent withdrawal", async () => {
    const recordId = await createOwnedRecord(USER_A);
    const withdrawn = await asUser(USER_A).delete("/api/v1/records/consent");
    expect(withdrawn.body.granted).toBe(false);
    const persist = await asUser(USER_A)
      .post(`/api/v1/records/${recordId}/persist`)
      .send({
        consentVersion: RECORDS_CONSENT_VERSION,
        sourceChannel: "web",
        facts: [
          {
            entryType: "note",
            patientWording: "should not persist",
            effectiveAt: "2026-09-02T12:00:00.000Z",
            confidence: "explicit",
          },
        ],
      });
    expect(persist.status).toBe(403);
  });

  it("takes urgency from the draft safety engine, not the request body", async () => {
    const recordId = await createOwnedRecord(USER_A);
    const persist = await asUser(USER_A)
      .post(`/api/v1/records/${recordId}/persist`)
      .send({
        consentVersion: RECORDS_CONSENT_VERSION,
        sourceChannel: "web",
        facts: [
          {
            entryType: "symptom",
            conceptCode: "abdominal_pain",
            patientWording: "Severe abdominal pain",
            valueJson: { severity: 8, confidence: "explicit" },
            effectiveAt: "2026-09-02T04:00:00.000Z",
            confidence: "explicit",
          },
        ],
      });
    expect(persist.status).toBe(201);

    const scored = await asUser(USER_A)
      .post(`/api/v1/records/${recordId}/scores`)
      .send({ urgencyClass: "monitor" });
    expect(scored.status).toBe(201);
    expect(scored.body.score.urgencyClass).toBe("urgent_today");
  });

  it("persists selected facts from an open voice session", async () => {
    const recordId = await createOwnedRecord(USER_A);
    const voice = createVoiceSession("en");
    acknowledgeDisclosure(voice.session.id, "voice.v1");
    const answered = await submitAnswer(voice.session.id, "Stomach pain since morning 6/10");
    const symptomId = answered.session.symptoms[0]?.id;
    expect(symptomId).toBeDefined();

    const persist = await asUser(USER_A)
      .post(`/api/v1/records/${recordId}/persist-from-voice`)
      .send({
        consentVersion: RECORDS_CONSENT_VERSION,
        sessionId: voice.session.id,
        selectedFactIds: [symptomId],
      });
    expect(persist.status).toBe(201);
    expect(persist.body.persistedCount).toBe(1);
    expect(persist.body.entries[0]?.sourceChannel).toBe("voice");
    expect(JSON.stringify(persist.body)).not.toContain(voice.session.id);

    const missingSession = await asUser(USER_A)
      .post(`/api/v1/records/${recordId}/persist-from-voice`)
      .send({
        consentVersion: RECORDS_CONSENT_VERSION,
        sessionId: "00000000-0000-4000-8000-000000000000",
        selectedFactIds: [symptomId],
      });
    expect(missingSession.status).toBe(404);
  });
});
