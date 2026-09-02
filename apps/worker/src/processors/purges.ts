import { recordPurgeVerifyJobSchema } from "@kkd/contracts";
import { createLogger } from "@kkd/observability";
import { countRemainingRecordRows } from "../lib/purge-verify.js";

const log = createLogger("worker.purges");

export type PurgeProcessorDeps = {
  remainingRows?: (recordId: string) => Promise<number | undefined>;
};

export async function processPurges(data: unknown, deps: PurgeProcessorDeps = {}): Promise<void> {
  const payload = recordPurgeVerifyJobSchema.parse(data);
  const remaining = await (deps.remainingRows ?? countRemainingRecordRows)(payload.recordId);
  if (remaining === undefined) {
    log.info({ event: "record_purge_verify", status: "no_store" });
    return;
  }
  if (remaining > 0) {
    throw new Error("purge_dependents_remain");
  }
  log.info({ event: "record_purge_verify", status: payload.kind });
}
