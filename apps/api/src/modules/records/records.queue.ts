import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  purgeJobPayloadSchema,
  recordExportJobSchema,
  type RecordExportJob,
  type RecordPurgeVerifyJob,
} from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import { createLogger } from "@kkd/observability";

const log = createLogger("records.queue");

let exportQueue: Queue | undefined;
let purgeQueue: Queue | undefined;
let redisFailed = false;

function tryGetQueue(name: "exports" | "purges"): Queue | undefined {
  if (redisFailed) {
    return undefined;
  }
  const existing = name === "exports" ? exportQueue : purgeQueue;
  if (existing) {
    return existing;
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
    const queue = new Queue(name, { connection: redis, prefix: "kkd" });
    if (name === "exports") {
      exportQueue = queue;
    } else {
      purgeQueue = queue;
    }
    return queue;
  } catch {
    redisFailed = true;
    return undefined;
  }
}

export async function enqueueRecordJob(
  payload: RecordExportJob | RecordPurgeVerifyJob,
): Promise<void> {
  const parsed =
    payload.kind === "record_export"
      ? recordExportJobSchema.parse(payload)
      : purgeJobPayloadSchema.parse(payload);
  const queueName = parsed.kind === "record_export" ? "exports" : "purges";
  const bull = tryGetQueue(queueName);
  if (!bull) {
    log.info({ event: "record_job_in_process", status: parsed.kind });
    return;
  }
  try {
    await bull.add(parsed.kind, parsed, {
      jobId: parsed.idempotencyKey,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
    });
    log.info({ event: "record_job_queued", status: parsed.kind });
  } catch {
    log.info({ event: "record_job_fallback", status: parsed.kind });
  }
}
