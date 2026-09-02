import type { Queue, Worker } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";
import { analyticsJobSchema } from "@kkd/contracts";
import {
  BULLMQ_PREFIX,
  createBullmqConnection,
  createKkdWorker,
  createQueue,
  defaultJobOptions,
} from "@kkd/queue";
import { processAnalytics } from "./processors/analytics.js";

const redisUrl = process.env.REDIS_URL;
const describeRedis = redisUrl ? describe : describe.skip;

describeRedis("BullMQ publisher + worker", () => {
  const connection = createBullmqConnection(redisUrl!);
  const workerConnection = connection.duplicate();
  let queue: Queue | undefined;
  let worker: Worker | undefined;

  afterAll(async () => {
    await worker?.close();
    await queue?.close();
    workerConnection.disconnect();
    connection.disconnect();
  });

  it("publishes a metadata-only probe job and processes it", async () => {
    const payload = analyticsJobSchema.parse({
      kind: "queue_probe",
      idempotencyKey: `queue-probe:${Date.now()}`,
    });
    queue = createQueue("analytics", connection);
    const completed = new Promise<void>((resolve, reject) => {
      worker = createKkdWorker(
        "analytics",
        async (job: { data: unknown }) => {
          await processAnalytics(job.data);
        },
        workerConnection,
      );
      const activeWorker = worker;
      activeWorker.on("completed", () => resolve());
      activeWorker.on("failed", (_job, error) => reject(error));
    });
    await queue.add(payload.kind, payload, {
      jobId: payload.idempotencyKey,
      ...defaultJobOptions,
    });
    await completed;
    expect(BULLMQ_PREFIX).toBe("kkd:bull");
  });
});
