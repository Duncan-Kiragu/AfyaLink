import { Redis } from "ioredis";
import { redisKeyPrefixes } from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import type { ExportCacheEntry } from "./records.store.js";

let client: Redis | undefined;
let redisFailed = false;

function redis(): Redis | undefined {
  if (redisFailed) {
    return undefined;
  }
  if (client) {
    return client;
  }
  const env = loadEnv();
  if (env.NODE_ENV === "test" || !env.REDIS_URL) {
    redisFailed = true;
    return undefined;
  }
  try {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      connectTimeout: 400,
      retryStrategy: () => null,
    });
    client.on("error", () => {
      redisFailed = true;
    });
    return client;
  } catch {
    redisFailed = true;
    return undefined;
  }
}

export async function putExportBundleInRedis(entry: ExportCacheEntry): Promise<boolean> {
  const connection = redis();
  if (!connection) {
    return false;
  }
  const ttlSeconds = Math.max(1, Math.ceil((entry.expiresAtMs - Date.now()) / 1000));
  try {
    await connection.set(
      redisKeyPrefixes.recordExport(entry.job.jobId),
      JSON.stringify(entry),
      "EX",
      ttlSeconds,
    );
    return true;
  } catch {
    redisFailed = true;
    return false;
  }
}

export async function getExportBundleFromRedis(jobId: string): Promise<ExportCacheEntry | undefined> {
  const connection = redis();
  if (!connection) {
    return undefined;
  }
  try {
    const raw = await connection.get(redisKeyPrefixes.recordExport(jobId));
    if (!raw) {
      return undefined;
    }
    return JSON.parse(raw) as ExportCacheEntry;
  } catch {
    redisFailed = true;
    return undefined;
  }
}
