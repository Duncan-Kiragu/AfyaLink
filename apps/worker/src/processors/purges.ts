import { recordPurgeVerifyJobSchema } from "@kkd/contracts";
import { createLogger } from "@kkd/observability";

const log = createLogger("worker.purges");

export async function processPurges(data: unknown): Promise<void> {
  const payload = recordPurgeVerifyJobSchema.parse(data);
  log.info({ event: "record_purge_verify", status: payload.kind });
}
