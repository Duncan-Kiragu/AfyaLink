import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadEnv } from "@kkd/config";
import { createLogger } from "@kkd/observability";
import { processExports } from "./exports.js";
import { processPurges } from "./purges.js";

const log = createLogger("worker.record-jobs");

export function startRecordJobWorkers(): Worker[] {
  const env = loadEnv();
  if (!env.REDIS_URL) {
    log.info({ event: "record_workers_skipped", status: "no_redis" });
    return [];
  }

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  connection.on("error", () => {
    log.info({ event: "record_worker_redis_error", status: "degraded" });
  });

  const exportsWorker = new Worker(
    "exports",
    async (job) => {
      await processExports(job.data);
    },
    { connection, prefix: "kkd" },
  );
  const purgesWorker = new Worker(
    "purges",
    async (job) => {
      await processPurges(job.data);
    },
    { connection: connection.duplicate(), prefix: "kkd" },
  );
  return [exportsWorker, purgesWorker];
}
