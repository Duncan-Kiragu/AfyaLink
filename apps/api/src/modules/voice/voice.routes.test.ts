import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { resetMockTelephonyEvents } from "@kkd/integrations";
import { createApp } from "../../app.js";
import { DISCLOSURE_VERSION } from "./voice.service.js";
import { resetVoiceSessions } from "./voice.store.js";

const app = createApp();

async function openSession(locale = "en") {
  const started = await request(app)
    .post("/api/v1/voice/sessions")
    .send({ locale, disclosureVersion: DISCLOSURE_VERSION });
  expect(started.status).toBe(201);
  const sessionId = started.body.session.id as string;
  const ack = await request(app)
    .post("/api/v1/voice/disclosure/ack")
    .send({ sessionId, disclosureVersion: DISCLOSURE_VERSION });
  expect(ack.status).toBe(200);
  return { sessionId, transport: started.body.transport as string };
}

describe("voice HTTP tools", () => {
  const previousFlag = process.env.FEATURE_VOICE;
  const previousKey = process.env.ELEVENLABS_API_KEY;
  const previousAgent = process.env.ELEVENLABS_AGENT_ID;

  beforeEach(() => {
    process.env.FEATURE_VOICE = "true";
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_AGENT_ID;
    resetVoiceSessions();
    resetMockTelephonyEvents();
  });

  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env.FEATURE_VOICE;
    } else {
      process.env.FEATURE_VOICE = previousFlag;
    }
    if (previousKey === undefined) {
      delete process.env.ELEVENLABS_API_KEY;
    } else {
      process.env.ELEVENLABS_API_KEY = previousKey;
    }
    if (previousAgent === undefined) {
      delete process.env.ELEVENLABS_AGENT_ID;
    } else {
      process.env.ELEVENLABS_AGENT_ID = previousAgent;
    }
  });

  it("returns 404 when the flag is off", async () => {
    process.env.FEATURE_VOICE = "false";
    const response = await request(app).get("/api/v1/voice/status");
    expect(response.status).toBe(404);
  });

  it("starts with disclosure, recording off, and mocked transport", async () => {
    const disclosure = await request(app).get("/api/v1/voice/disclosure");
    expect(disclosure.body.requiresAcknowledgement).toBe(true);
    expect(disclosure.body.text.toLowerCase()).toContain("does not diagnose");

    const { sessionId, transport } = await openSession();
    expect(transport).toBe("mock_browser");

    const status = await request(app).get("/api/v1/voice/status");
    expect(status.body.recordingEnabled).toBe(false);

    const ringing = await request(app).post("/api/v1/voice/telephony/status").send({
      sessionId,
      providerEventId: "evt-1",
      status: "ringing",
    });
    expect(ringing.body.duplicate).toBe(false);
    const duplicate = await request(app).post("/api/v1/voice/telephony/status").send({
      sessionId,
      providerEventId: "evt-1",
      status: "in_progress",
    });
    expect(duplicate.body.duplicate).toBe(true);
    expect(duplicate.body.mockCall.status).toBe("ringing");
  });

  it("collects two facts, evaluates safety, and allows cancelling a callback", async () => {
    const { sessionId } = await openSession();
    const first = await request(app).post("/api/v1/voice/tools/submit_patient_answer").send({
      sessionId,
      text: "My abdomen has hurt since yesterday",
    });
    expect(first.status).toBe(200);
    const second = await request(app).post("/api/v1/voice/tools/submit_patient_answer").send({
      sessionId,
      text: "The pain is 6/10",
    });
    expect(second.body.safety.ruleSetVersion).toBe("voice-stub.v0");

    const safety = await request(app)
      .post("/api/v1/voice/tools/evaluate_safety")
      .send({ sessionId });
    expect(safety.body.safety.urgency).not.toBe("emergency");

    const summary = await request(app)
      .post("/api/v1/voice/tools/get_factual_summary")
      .send({ sessionId });
    expect(summary.body.summary.recommendedNextAction.toLowerCase()).not.toMatch(
      /you have|you may have|this sounds like/,
    );
    expect(summary.body.summary.model).toBe("none-deterministic-stub");

    const callback = await request(app).post("/api/v1/voice/callback").send({ sessionId });
    expect(callback.body.accepted).toBe(true);
    const cancelled = await request(app).post("/api/v1/voice/callback/cancel").send({ sessionId });
    expect(cancelled.body.messageKey).toBe("voice.job.cancelled");
  });
});
