import { voiceJobPayloadSchema, type VoiceJobPayload, type VoiceJobResult } from "@kkd/contracts";
import { processVoiceJob } from "@kkd/integrations";
import { createLogger } from "@kkd/observability";
import { enqueueOnQueue, removeQueuedJob } from "../../services/queues.js";

const log = createLogger("voice.queue");

export async function enqueueVoiceJob(payload: VoiceJobPayload): Promise<VoiceJobResult> {
  const parsed = voiceJobPayloadSchema.parse(payload);
  const queued = await enqueueOnQueue(
    "voice-callbacks",
    parsed.kind,
    parsed,
    parsed.idempotencyKey,
  );
  if (queued === "queued") {
    log.info({ event: "voice_job_queued", status: parsed.kind });
    return {
      accepted: true,
      transport: "bullmq",
      messageKey: "voice.job.queued",
    };
  }
  if (queued === "failed") {
    log.info({ event: "voice_job_fallback", status: "bullmq_failed" });
  }

  const result = await processVoiceJob(parsed);
  log.info({ event: result.event, status: parsed.kind });
  return {
    accepted: true,
    transport: "in_process",
    messageKey: "voice.job.inProcess",
  };
}

export async function cancelQueuedVoiceJob(idempotencyKey: string): Promise<void> {
  await removeQueuedJob("voice-callbacks", idempotencyKey);
}
