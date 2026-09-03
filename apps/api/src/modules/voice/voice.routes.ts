import { Router } from "express";
import {
  acknowledgeDisclosureInputSchema,
  aiDisclosureSchema,
  startVoiceSessionInputSchema,
  startVoiceSessionResponseSchema,
  type LiveVoiceFallbackReason,
  submitPatientAnswerInputSchema,
  telephonyStatusEventSchema,
  voiceSessionIdInputSchema,
  voiceSmsRequestSchema,
  voiceStatusResponseSchema,
} from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import { applyMockTelephonyEvent, fetchConversationToken } from "@kkd/integrations";
import { createLogger } from "@kkd/observability";
import { validate } from "../../middleware/validate.js";
import { cancelQueuedVoiceJob, enqueueVoiceJob } from "./voice.queue.js";
import {
  acknowledgeDisclosure,
  assertDisclosure,
  cancelInterviewCallback,
  closeSession,
  createVoiceSession,
  DISCLOSURE_VERSION,
  factualSummary,
  nextQuestion,
  requestInterviewCallback,
  requireOpenSession,
  submitAnswer,
} from "./voice.service.js";
import { saveVoiceSession } from "./voice.store.js";

const log = createLogger("voice.routes");

function liveFallbackReasonFromError(reason: string): LiveVoiceFallbackReason {
  if (reason === "elevenlabs_not_configured") {
    return "elevenlabs_not_configured";
  }
  if (reason === "elevenlabs_token_invalid") {
    return "elevenlabs_token_invalid";
  }
  if (reason.includes("missing_permissions")) {
    return "elevenlabs_missing_permissions";
  }
  if (reason.startsWith("elevenlabs_token_failed:401")) {
    return "elevenlabs_unauthorized";
  }
  return "elevenlabs_token_failed";
}

export const voiceRouter = Router();

voiceRouter.use((_req, res, next) => {
  const env = loadEnv();
  if (!env.FEATURE_VOICE) {
    res.status(404).json({ error: "voice_disabled" });
    return;
  }
  next();
});

voiceRouter.get("/status", (_req, res) => {
  const env = loadEnv();
  res.json(
    voiceStatusResponseSchema.parse({
      enabled: true,
      elevenLabsConfigured: Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_AGENT_ID),
      recordingEnabled: false,
      disclosureVersion: DISCLOSURE_VERSION,
    }),
  );
});

voiceRouter.get("/disclosure", (req, res) => {
  const locale = typeof req.query.locale === "string" ? req.query.locale : "en";
  const sw = locale.toLowerCase().startsWith("sw");
  res.json(
    aiDisclosureSchema.parse({
      id: "voice-disclosure",
      version: DISCLOSURE_VERSION,
      locale: sw ? "sw" : "en",
      channel: "voice",
      requiresAcknowledgement: true,
      text: sw
        ? "Mazungumzo haya yanatumia AI. KKD haitoi utambuzi wa ugonjwa. Inakusaidia kueleza dalili kabla ya kuongea na mtaalamu wa afya. Usitegemee zana hii wakati wa dharura. Simu hii ni ya kukusanya ukweli; si daktari. Mahojiano haya ni ya muda isipokuwa baadaye uchague kuhifadhi ukweli uliochaguliwa kwenye rekodi yako ya afya."
        : "This conversation uses AI. KKD does not diagnose. It helps you describe symptoms before you speak to a healthcare professional. Do not rely on it in an emergency. This call collects facts; it is not a doctor. This interview is temporary unless you later choose to save selected facts to your health record.",
    }),
  );
});

voiceRouter.post("/sessions", validate(startVoiceSessionInputSchema), async (req, res, next) => {
  try {
    const body = startVoiceSessionInputSchema.parse(req.body);
    if (body.disclosureVersion !== DISCLOSURE_VERSION) {
      res.status(409).json({ error: "voice_disclosure_version" });
      return;
    }
    const record = createVoiceSession(body.locale);

    const env = loadEnv();
    let conversationToken: string | undefined;
    let agentId: string | undefined;
    let transport: "elevenlabs_webrtc" | "mock_browser" = "mock_browser";
    let liveFallbackReason: LiveVoiceFallbackReason | undefined;

    try {
      const creds = await fetchConversationToken(env);
      conversationToken = creds.conversationToken;
      agentId = creds.agentId;
      transport = "elevenlabs_webrtc";
    } catch (error) {
      const reason = error instanceof Error ? error.message : "elevenlabs_unavailable";
      liveFallbackReason = liveFallbackReasonFromError(reason);
      log.info({ event: "elevenlabs_unavailable", status: reason });
    }

    res.status(201).json(
      startVoiceSessionResponseSchema.parse({
        session: record.session,
        transport,
        conversationToken,
        agentId,
        liveFallbackReason,
        mockCall: { status: record.mockCallStatus },
        recordingEnabled: false,
      }),
    );
  } catch (error) {
    next(error);
  }
});

voiceRouter.post(
  "/disclosure/ack",
  validate(acknowledgeDisclosureInputSchema),
  (req, res, next) => {
    try {
      const body = acknowledgeDisclosureInputSchema.parse(req.body);
      const record = acknowledgeDisclosure(body.sessionId, body.disclosureVersion);
      res.json({ session: record.session });
    } catch (error) {
      next(error);
    }
  },
);

voiceRouter.get("/sessions/:id", (req, res, next) => {
  try {
    const record = requireOpenSession(String(req.params.id));
    res.json({
      session: record.session,
      mockCall: { status: record.mockCallStatus },
      disclosureAcknowledged: record.disclosureAcknowledged,
    });
  } catch (error) {
    next(error);
  }
});

voiceRouter.post(
  "/tools/submit_patient_answer",
  validate(submitPatientAnswerInputSchema),
  async (req, res, next) => {
    try {
      const body = submitPatientAnswerInputSchema.parse(req.body);
      const record = await submitAnswer(body.sessionId, body.text);
      res.json({
        session: record.session,
        safety: record.session.safety,
        nextQuestion: nextQuestion(record),
      });
    } catch (error) {
      next(error);
    }
  },
);

voiceRouter.post(
  "/tools/get_next_question",
  validate(voiceSessionIdInputSchema),
  (req, res, next) => {
    try {
      const body = voiceSessionIdInputSchema.parse(req.body);
      const record = requireOpenSession(body.sessionId);
      assertDisclosure(record);
      res.json({
        session: record.session,
        safety: record.session.safety,
        nextQuestion: nextQuestion(record),
      });
    } catch (error) {
      next(error);
    }
  },
);

voiceRouter.post(
  "/tools/evaluate_safety",
  validate(voiceSessionIdInputSchema),
  (req, res, next) => {
    try {
      const body = voiceSessionIdInputSchema.parse(req.body);
      const record = requireOpenSession(body.sessionId);
      assertDisclosure(record);
      res.json({
        session: record.session,
        safety: record.session.safety,
        nextQuestion: nextQuestion(record),
      });
    } catch (error) {
      next(error);
    }
  },
);

voiceRouter.post(
  "/tools/get_factual_summary",
  validate(voiceSessionIdInputSchema),
  async (req, res, next) => {
    try {
      const body = voiceSessionIdInputSchema.parse(req.body);
      const record = requireOpenSession(body.sessionId);
      assertDisclosure(record);
      res.json({
        session: record.session,
        safety: record.session.safety,
        summary: await factualSummary(record),
      });
    } catch (error) {
      next(error);
    }
  },
);

voiceRouter.post(
  "/tools/close_session",
  validate(voiceSessionIdInputSchema),
  (req, res, next) => {
    try {
      const body = voiceSessionIdInputSchema.parse(req.body);
      const record = closeSession(body.sessionId);
      res.json({
        session: record.session,
        safety: record.session.safety,
        closed: true,
      });
    } catch (error) {
      next(error);
    }
  },
);

voiceRouter.post(
  "/telephony/status",
  validate(telephonyStatusEventSchema),
  (req, res, next) => {
    try {
      const body = telephonyStatusEventSchema.parse(req.body);
      const record = requireOpenSession(body.sessionId);
      const result = applyMockTelephonyEvent(body);
      if (!result.duplicate) {
        record.mockCallStatus = body.status;
        saveVoiceSession(record);
      }
      res.json({
        duplicate: result.duplicate,
        mockCall: { status: record.mockCallStatus },
      });
    } catch (error) {
      next(error);
    }
  },
);

voiceRouter.post("/summary-sms", validate(voiceSmsRequestSchema), async (req, res, next) => {
  try {
    const body = voiceSmsRequestSchema.parse(req.body);
    const record = requireOpenSession(body.sessionId);
    assertDisclosure(record);
    const last4 = body.phone.slice(-4);
    const result = await enqueueVoiceJob({
      kind: "summary_sms",
      idempotencyKey: `sms:${record.session.id}:${last4}`,
      sessionId: record.session.id,
      locale: record.session.locale,
      phoneLast4: last4,
      summary: await factualSummary(record),
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

voiceRouter.post("/callback", validate(voiceSessionIdInputSchema), async (req, res, next) => {
  try {
    const body = voiceSessionIdInputSchema.parse(req.body);
    const record = requireOpenSession(body.sessionId);
    assertDisclosure(record);
    const requested = requestInterviewCallback(record);
    if (requested.alreadyRequested) {
      res.json({
        accepted: true,
        transport: "in_process",
        messageKey: "voice.job.queued",
      });
      return;
    }
    const result = await enqueueVoiceJob({
      kind: "interview_callback",
      idempotencyKey: requested.idempotencyKey,
      sessionId: record.session.id,
      locale: record.session.locale,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

voiceRouter.post(
  "/callback/cancel",
  validate(voiceSessionIdInputSchema),
  async (req, res, next) => {
    try {
      const body = voiceSessionIdInputSchema.parse(req.body);
      const record = cancelInterviewCallback(body.sessionId);
      if (record.callbackIdempotencyKey) {
        await cancelQueuedVoiceJob(record.callbackIdempotencyKey);
      }
      res.json({
        accepted: true,
        transport: "in_process",
        messageKey: "voice.job.cancelled",
      });
    } catch (error) {
      next(error);
    }
  },
);
