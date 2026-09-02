import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { voiceJobPayloadSchema } from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import { processVoiceJob } from "@kkd/integrations";
import { createLogger } from "@kkd/observability";

const log = createLogger("worker.voice");

export async function processVoiceCallbacks(data: unknown): Promise<void> {
  const payload = voiceJobPayloadSchema.parse(data);
  const result = await processVoiceJob(payload);
  log.info({ event: result.event, status: payload.kind });
}

export function startVoiceCallbackWorker(): Worker | undefined {
  const env = loadEnv();
  if (!env.REDIS_URL) {
    log.info({ event: "voice_worker_skipped", status: "no_redis" });
    return undefined;
  }

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on("error", () => {
    log.info({ event: "voice_worker_redis_error", status: "degraded" });
  });

  return new Worker(
    "voice-callbacks",
    async (job) => {
      await processVoiceCallbacks(job.data);
    },
    { connection, prefix: "kkd" },
  );
}
