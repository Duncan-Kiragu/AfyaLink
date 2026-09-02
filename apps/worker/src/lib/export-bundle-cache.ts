import { Redis } from "ioredis";
import { redisKeyPrefixes, type ExportJob } from "@kkd/contracts";
import { loadEnv } from "@kkd/config";

export type WorkerExportCacheEntry = {
  job: ExportJob;
  userId: string;
  recordId: string;
  bundleJson: string;
  expiresAtMs: number;
};

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
  if (!env.REDIS_URL) {
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

export async function putExportCacheEntry(entry: WorkerExportCacheEntry): Promise<boolean> {
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
