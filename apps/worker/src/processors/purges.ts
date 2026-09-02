import { redisKeyPrefixes, purgeJobPayloadSchema } from "@kkd/contracts";
import { createLogger } from "@kkd/observability";
import { countRemainingRecordRows } from "../lib/purge-verify.js";
import { getWorkerCommandRedis } from "../redis.js";

const log = createLogger("worker.purges");

const SESSION_KEY_PATTERN = "kkd:session:*";

export type PurgeProcessorDeps = {
  remainingRows?: (recordId: string) => Promise<number | undefined>;
};

async function sweepOrphanSessions(): Promise<void> {
  const redis = getWorkerCommandRedis();
  if (!redis) {
    return;
  }
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", SESSION_KEY_PATTERN, "COUNT", 100);
    cursor = next;
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      if (ttl === -1) {
        await redis.del(key);
        log.info({ event: "session_orphan_purged", status: "deleted" });
      }
    }
  } while (cursor !== "0");
}

export async function processPurges(data: unknown, deps: PurgeProcessorDeps = {}): Promise<void> {
  const payload = purgeJobPayloadSchema.parse(data);
  if (payload.kind === "record_purge_verify") {
    const remaining = await (deps.remainingRows ?? countRemainingRecordRows)(payload.recordId);
    if (remaining === undefined) {
      log.info({ event: "record_purge_verify", status: "no_store" });
      return;
    }
    if (remaining > 0) {
      throw new Error("purge_dependents_remain");
    }
    log.info({ event: "record_purge_verify", status: payload.kind });
    return;
  }
  if (payload.kind === "session_purge") {
    const redis = getWorkerCommandRedis();
    if (redis) {
      await redis.del(redisKeyPrefixes.session(payload.sessionId));
    }
    log.info({ event: "session_purged", status: "deleted" });
    return;
  }
  await sweepOrphanSessions();
  log.info({ event: "session_orphan_sweep", status: "completed" });
}
