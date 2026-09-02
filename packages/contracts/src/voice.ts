import { z } from "zod";
import { localeSchema } from "./common.js";
import { consultationSummarySchema } from "./ai.js";
import { safetyAssessmentSchema } from "./safety.js";
import { kkdSessionSchema } from "./session.js";

export const voiceToolNameSchema = z.enum([
  "submit_patient_answer",
  "get_next_question",
  "evaluate_safety",
  "get_factual_summary",
  "close_session",
]);
export type VoiceToolName = z.infer<typeof voiceToolNameSchema>;

export const mockCallStatusSchema = z.enum([
  "idle",
  "ringing",
  "in_progress",
  "ended",
  "failed",
]);
export type MockCallStatus = z.infer<typeof mockCallStatusSchema>;

export const voiceTransportSchema = z.enum(["elevenlabs_webrtc", "mock_browser"]);
export type VoiceTransport = z.infer<typeof voiceTransportSchema>;

export const startVoiceSessionInputSchema = z.object({
  locale: localeSchema.default("en"),
  disclosureVersion: z.string().min(1),
});
export type StartVoiceSessionInput = z.infer<typeof startVoiceSessionInputSchema>;

export const startVoiceSessionResponseSchema = z.object({
  session: kkdSessionSchema,
  transport: voiceTransportSchema,
  conversationToken: z.string().optional(),
  agentId: z.string().optional(),
  mockCall: z.object({
    status: mockCallStatusSchema,
  }),
  recordingEnabled: z.literal(false),
});
export type StartVoiceSessionResponse = z.infer<typeof startVoiceSessionResponseSchema>;

export const acknowledgeDisclosureInputSchema = z.object({
  sessionId: z.string().min(1),
  disclosureVersion: z.string().min(1),
});
export type AcknowledgeDisclosureInput = z.infer<typeof acknowledgeDisclosureInputSchema>;

export const submitPatientAnswerInputSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(2000),
});
export type SubmitPatientAnswerInput = z.infer<typeof submitPatientAnswerInputSchema>;

export const voiceSessionIdInputSchema = z.object({
  sessionId: z.string().min(1),
});
export type VoiceSessionIdInput = z.infer<typeof voiceSessionIdInputSchema>;

export const telephonyStatusEventSchema = z.object({
  sessionId: z.string().min(1),
  providerEventId: z.string().min(1),
  status: mockCallStatusSchema,
});
export type TelephonyStatusEvent = z.infer<typeof telephonyStatusEventSchema>;

export const voiceSmsRequestSchema = z.object({
  sessionId: z.string().min(1),
  phone: z.string().min(8).max(20),
});
export type VoiceSmsRequest = z.infer<typeof voiceSmsRequestSchema>;

export const voiceJobKindSchema = z.enum(["summary_sms", "interview_callback"]);
export type VoiceJobKind = z.infer<typeof voiceJobKindSchema>;

export const voiceJobPayloadSchema = z.object({
  kind: voiceJobKindSchema,
  idempotencyKey: z.string().min(1),
  sessionId: z.string().min(1),
  locale: localeSchema,
  phoneLast4: z.string().optional(),
  summary: consultationSummarySchema.optional(),
});
export type VoiceJobPayload = z.infer<typeof voiceJobPayloadSchema>;

export const voiceJobResultSchema = z.object({
  accepted: z.boolean(),
  transport: z.enum(["bullmq", "in_process"]),
  messageKey: z.string(),
});
export type VoiceJobResult = z.infer<typeof voiceJobResultSchema>;

export const voiceToolResponseSchema = z.object({
  session: kkdSessionSchema,
  safety: safetyAssessmentSchema,
  nextQuestion: z.string().optional(),
  summary: consultationSummarySchema.optional(),
  closed: z.boolean().optional(),
});
export type VoiceToolResponse = z.infer<typeof voiceToolResponseSchema>;

export const voiceStatusResponseSchema = z.object({
  enabled: z.boolean(),
  elevenLabsConfigured: z.boolean(),
  recordingEnabled: z.literal(false),
  disclosureVersion: z.string(),
});
export type VoiceStatusResponse = z.infer<typeof voiceStatusResponseSchema>;

export const voiceCallbackStatusSchema = z.enum(["none", "requested", "cancelled"]);
export type VoiceCallbackStatus = z.infer<typeof voiceCallbackStatusSchema>;
