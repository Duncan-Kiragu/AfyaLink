import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { QueueName } from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import { createBullmqConnection, createQueue, defaultJobOptions } from "@kkd/queue";
import { createLogger } from "@kkd/observability";

const log = createLogger("queues");
const queues = new Map<QueueName, Queue>();
let connection: Redis | undefined;
let redisFailed = false;

function tryGetQueue(name: QueueName): Queue | undefined {
  if (redisFailed) return undefined;
  const existing = queues.get(name);
  if (existing) return existing;
  const env = loadEnv();
  if (env.NODE_ENV === "test" || !env.REDIS_URL) {
    redisFailed = true;
    return undefined;
  }
  try {
    connection ??= createBullmqConnection(env.REDIS_URL, {
      enableOfflineQueue: false,
      connectTimeout: 400,
      retryStrategy: () => null,
    });
    connection.on("error", () => {
      redisFailed = true;
    });
    const queue = createQueue(name, connection);
    queues.set(name, queue);
    return queue;
  } catch {
    redisFailed = true;
    return undefined;
  }
}

export async function enqueueOnQueue(
  name: QueueName,
  jobName: string,
  data: object,
  idempotencyKey: string,
): Promise<"queued" | "skipped" | "failed"> {
  const queue = tryGetQueue(name);
  if (!queue) return "skipped";
  try {
    await queue.add(jobName, data, { jobId: idempotencyKey, ...defaultJobOptions });
    log.info({ event: "job_queued", status: jobName });
    return "queued";
  } catch {
    log.info({ event: "job_enqueue_failed", status: jobName });
    return "failed";
  }
}

export async function removeQueuedJob(name: QueueName, idempotencyKey: string): Promise<void> {
  const queue = tryGetQueue(name);
  if (!queue) return;
  try {
    await queue.remove(idempotencyKey);
  } catch {
    return;
  }
}
