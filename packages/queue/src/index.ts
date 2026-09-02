import { Queue, Worker, type Processor } from "bullmq";
import { Redis, type RedisOptions } from "ioredis";
import { type QueueName } from "@kkd/contracts";

/** BullMQ key prefix so queue keys match `kkd:bull:{queue}` (spec §4.E). */
export const BULLMQ_PREFIX = "kkd:bull";

export const defaultJobOptions = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 1000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 1000 },
} as const;

export function createBullmqConnection(url: string, extra: RedisOptions = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    ...extra,
  });
}

export function createCommandConnection(url: string, extra: RedisOptions = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 500,
    retryStrategy: (times) => (times > 3 ? null : 50 * times),
    ...extra,
  });
}

export async function pingRedis(redis: Redis): Promise<boolean> {
  try {
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}

export async function pingRedisUrl(url: string): Promise<boolean> {
  const redis = createCommandConnection(url, { retryStrategy: () => null, connectTimeout: 400 });
  try {
    return await pingRedis(redis);
  } finally {
    redis.disconnect();
  }
}

export function createQueue(name: QueueName, connection: Redis): Queue {
  return new Queue(name, {
    connection,
    prefix: BULLMQ_PREFIX,
    defaultJobOptions,
  });
}

export function createKkdWorker(name: QueueName, processor: Processor, connection: Redis): Worker {
  return new Worker(name, processor, {
    connection,
    prefix: BULLMQ_PREFIX,
  });
}
