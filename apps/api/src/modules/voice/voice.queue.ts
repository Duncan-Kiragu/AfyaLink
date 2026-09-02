import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { voiceJobPayloadSchema, type VoiceJobPayload, type VoiceJobResult } from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import { processVoiceJob } from "@kkd/integrations";
import { createLogger } from "@kkd/observability";

const log = createLogger("voice.queue");

let queue: Queue | undefined;
let redisFailed = false;

function tryGetQueue(): Queue | undefined {
  if (redisFailed) {
    return undefined;
  }
  if (queue) {
    return queue;
  }
  const env = loadEnv();
  if (env.NODE_ENV === "test" || !env.REDIS_URL) {
    redisFailed = true;
    return undefined;
  }
  try {
    const redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      connectTimeout: 400,
      retryStrategy: () => null,
    });
    redis.on("error", () => {
      redisFailed = true;
    });
    queue = new Queue("voice-callbacks", { connection: redis, prefix: "kkd" });
    return queue;
  } catch {
    redisFailed = true;
    return undefined;
  }
}

export async function enqueueVoiceJob(payload: VoiceJobPayload): Promise<VoiceJobResult> {
  const parsed = voiceJobPayloadSchema.parse(payload);
  const bull = tryGetQueue();
  if (bull) {
    try {
      await bull.add(parsed.kind, parsed, {
        jobId: parsed.idempotencyKey,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
      });
      log.info({ event: "voice_job_queued", status: parsed.kind });
      return {
        accepted: true,
        transport: "bullmq",
        messageKey: "voice.job.queued",
      };
    } catch {
      log.info({ event: "voice_job_fallback", status: "bullmq_failed" });
    }
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
  const bull = tryGetQueue();
  if (!bull) {
    return;
  }
  try {
    await bull.remove(idempotencyKey);
  } catch {
    log.info({ event: "voice_job_cancel_miss", status: "already_gone" });
  }
}
