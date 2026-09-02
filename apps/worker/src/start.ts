import type { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { QUEUE_NAMES, type QueueName } from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import { createLogger } from "@kkd/observability";
import { createBullmqConnection, createKkdWorker, createQueue } from "@kkd/queue";
import { processAnalytics } from "./processors/analytics.js";
import { processExports } from "./processors/exports.js";
import { processFollowups } from "./processors/followups.js";
import { processNotifications } from "./processors/notifications.js";
import { processProviderSync } from "./processors/provider-sync.js";
import { processPurges } from "./processors/purges.js";
import { processVoiceCallbacks } from "./processors/voice-callbacks.js";
import { closeWorkerCommandRedis } from "./redis.js";

const log = createLogger("worker");

export const processors = {
  followups: processFollowups,
  notifications: processNotifications,
  "provider-sync": processProviderSync,
  "voice-callbacks": processVoiceCallbacks,
  exports: processExports,
  purges: processPurges,
  analytics: processAnalytics,
} as const satisfies Record<QueueName, (data: unknown) => Promise<void>>;

const ORPHAN_SWEEP_EVERY_MS = 15 * 60 * 1000;

export async function startWorkers(): Promise<{ close: () => Promise<void> }> {
  const env = loadEnv();
  if (!env.REDIS_URL) {
    log.info({ event: "worker_skipped", status: "no_redis" });
    return { close: async () => undefined };
  }

  const connection = createBullmqConnection(env.REDIS_URL);
  connection.on("error", () => {
    log.info({ event: "worker_redis_error", status: "degraded" });
  });

  const workers: Worker[] = [];
  const workerConnections: Redis[] = [];
  const metricQueues = QUEUE_NAMES.map((name) => createQueue(name, connection));

  for (const name of QUEUE_NAMES) {
    const workerConnection = connection.duplicate();
    workerConnection.on("error", () => {
      log.info({ event: "worker_redis_error", status: "degraded" });
    });
    workerConnections.push(workerConnection);
    const worker = createKkdWorker(
      name,
      async (job: { data: unknown }) => {
        await processors[name](job.data);
      },
      workerConnection,
    );
    worker.on("failed", () => {
      log.info({ event: "job_failed", status: name });
    });
    workers.push(worker);
  }

  const purgesQueue = metricQueues.find((queue) => queue.name === "purges");
  if (purgesQueue) {
    await purgesQueue.upsertJobScheduler(
      "session-orphan-sweep",
      { every: ORPHAN_SWEEP_EVERY_MS },
      {
        name: "session_orphan_sweep",
        data: { kind: "session_orphan_sweep", idempotencyKey: "session-orphan-sweep" },
      },
    );
  }

  const metricsTimer = setInterval(() => {
    void logQueueDepth(metricQueues);
  }, 30_000);

  async function close(): Promise<void> {
    clearInterval(metricsTimer);
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all(metricQueues.map((queue) => queue.close()));
    closeWorkerCommandRedis();
    for (const workerConnection of workerConnections) {
      workerConnection.disconnect();
    }
    connection.disconnect();
  }

  process.once("SIGTERM", () => {
    void close().then(() => process.exit(0));
  });
  process.once("SIGINT", () => {
    void close().then(() => process.exit(0));
  });

  log.info(
    {
      event: "worker_boot",
      appEnv: env.APP_ENV,
      status: QUEUE_NAMES.join(","),
    },
    "worker started",
  );

  return { close };
}

async function logQueueDepth(queues: ReturnType<typeof createQueue>[]): Promise<void> {
  const parts: string[] = [];
  for (const queue of queues) {
    try {
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
      parts.push(`${queue.name}:${String(counts.waiting ?? 0)}/${String(counts.failed ?? 0)}`);
    } catch {
      parts.push(`${queue.name}:err`);
    }
  }
  log.info({ event: "queue_depth", status: parts.join(",") });
}
