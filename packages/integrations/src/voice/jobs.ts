import type { VoiceJobPayload } from "@kkd/contracts";

export async function processVoiceJob(payload: VoiceJobPayload): Promise<{ event: string }> {
  if (payload.kind === "summary_sms") {
    return { event: "voice_sms_mock_sent" };
  }
  return { event: "voice_interview_callback_mock" };
}
