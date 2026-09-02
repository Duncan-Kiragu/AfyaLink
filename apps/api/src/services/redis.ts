import { Redis } from "ioredis";

/**
 * Single shared Redis client for the API process.
 *
 * Redis is the only home for ephemeral clinical session state, so a failure to
 * reach it must surface as a service-unavailable rather than a session that
 * cannot be safely expired or purged (spec §20).
 */

export class RedisUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Redis is unavailable");
    this.name = "RedisUnavailableError";
    this.cause = cause;
  }
}

let client: Redis | undefined;

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
    // Fail fast: a clinical request must not hang waiting on a dead cache.
    connectTimeout: 5_000,
    commandTimeout: 3_000,
  });
}

export function getRedis(url: string | undefined): Redis {
  if (!url) throw new RedisUnavailableError(new Error("REDIS_URL is not configured"));
  client ??= createRedisClient(url);
  return client;
}

export function setRedisForTesting(instance: Redis | undefined): void {
  client = instance;
}

export async function closeRedis(): Promise<void> {
  const instance = client;
  client = undefined;
  if (instance) await instance.quit().catch(() => undefined);
}

export async function pingRedis(url: string | undefined): Promise<boolean> {
  try {
    const result = await getRedis(url).ping();
    return result === "PONG";
  } catch {
    return false;
  }
}
