import type { Redis } from "ioredis";
import { loadEnv } from "@kkd/config";
import { createCommandConnection } from "@kkd/queue";

let commandRedis: Redis | undefined;

export function getWorkerCommandRedis(): Redis | undefined {
  if (commandRedis) {
    return commandRedis;
  }
  const env = loadEnv();
  if (!env.REDIS_URL) {
    return undefined;
  }
  commandRedis = createCommandConnection(env.REDIS_URL);
  const redis = commandRedis;
  redis.on("error", () => undefined);
  return redis;
}

export function closeWorkerCommandRedis(): void {
  if (!commandRedis) {
    return;
  }
  commandRedis.disconnect();
  commandRedis = undefined;
}
