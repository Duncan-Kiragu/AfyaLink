import { apiV1 } from "@kkd/contracts";
import {
  acknowledgeDisclosureInputSchema,
  aiDisclosureSchema,
  startVoiceSessionInputSchema,
  startVoiceSessionResponseSchema,
  submitPatientAnswerInputSchema,
  telephonyStatusEventSchema,
  voiceJobResultSchema,
  voiceSessionIdInputSchema,
  voiceSmsRequestSchema,
  voiceStatusResponseSchema,
  voiceToolResponseSchema,
} from "@kkd/contracts";
import { apiClient } from "../../api";

async function parseJson(response: Response): Promise<unknown> {
  return response.json();
}

export async function fetchVoiceStatus() {
  const response = await apiClient.request(apiV1.voiceStatus);
  return voiceStatusResponseSchema.parse(await parseJson(response));
}

export async function fetchVoiceDisclosure(locale: string) {
  const response = await apiClient.request(
    `${apiV1.voiceDisclosure}?locale=${encodeURIComponent(locale)}`,
  );
  return aiDisclosureSchema.parse(await parseJson(response));
}

export async function startVoiceSession(input: { locale: string; disclosureVersion: string }) {
  const body = startVoiceSessionInputSchema.parse(input);
  const response = await apiClient.request(apiV1.voiceSessions, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("voice_start_failed");
  }
  return startVoiceSessionResponseSchema.parse(await parseJson(response));
}

export async function ackVoiceDisclosure(sessionId: string, disclosureVersion: string) {
  const body = acknowledgeDisclosureInputSchema.parse({ sessionId, disclosureVersion });
  const response = await apiClient.request(apiV1.voiceDisclosureAck, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("voice_ack_failed");
  }
}

export async function submitVoiceAnswer(sessionId: string, text: string) {
  const body = submitPatientAnswerInputSchema.parse({ sessionId, text });
  const response = await apiClient.request(apiV1.voiceToolSubmit, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("voice_submit_failed");
  }
  return voiceToolResponseSchema.parse(await parseJson(response));
}

export async function fetchNextQuestion(sessionId: string) {
  const body = voiceSessionIdInputSchema.parse({ sessionId });
  const response = await apiClient.request(apiV1.voiceToolNextQuestion, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("voice_next_question_failed");
  }
  return voiceToolResponseSchema.parse(await parseJson(response));
}

export async function evaluateVoiceSafety(sessionId: string) {
  const body = voiceSessionIdInputSchema.parse({ sessionId });
  const response = await apiClient.request(apiV1.voiceToolSafety, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("voice_safety_failed");
  }
  return voiceToolResponseSchema.parse(await parseJson(response));
}

export async function fetchVoiceSummary(sessionId: string) {
  const body = voiceSessionIdInputSchema.parse({ sessionId });
  const response = await apiClient.request(apiV1.voiceToolSummary, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("voice_summary_failed");
  }
  return voiceToolResponseSchema.parse(await parseJson(response));
}

export async function closeVoiceSession(sessionId: string) {
  const body = voiceSessionIdInputSchema.parse({ sessionId });
  await apiClient.request(apiV1.voiceToolClose, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function reportMockCallStatus(
  sessionId: string,
  status: "ringing" | "in_progress" | "ended" | "failed",
  providerEventId: string,
) {
  const body = telephonyStatusEventSchema.parse({ sessionId, status, providerEventId });
  await apiClient.request(apiV1.voiceTelephonyStatus, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function requestSummarySms(sessionId: string, phone: string) {
  const body = voiceSmsRequestSchema.parse({ sessionId, phone });
  const response = await apiClient.request(apiV1.voiceSummarySms, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("voice_sms_failed");
  }
  return voiceJobResultSchema.parse(await parseJson(response));
}

export async function requestInterviewCallback(sessionId: string) {
  const body = voiceSessionIdInputSchema.parse({ sessionId });
  const response = await apiClient.request(apiV1.voiceCallback, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("voice_callback_failed");
  }
  return voiceJobResultSchema.parse(await parseJson(response));
}

export async function cancelInterviewCallback(sessionId: string) {
  const body = voiceSessionIdInputSchema.parse({ sessionId });
  const response = await apiClient.request(apiV1.voiceCallbackCancel, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error("voice_callback_cancel_failed");
  }
  return voiceJobResultSchema.parse(await parseJson(response));
}
