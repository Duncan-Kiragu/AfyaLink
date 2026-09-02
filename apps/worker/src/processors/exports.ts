import { recordExportJobSchema } from "@kkd/contracts";
import { createLogger } from "@kkd/observability";

const log = createLogger("worker.exports");

export async function processExports(data: unknown): Promise<void> {
  const payload = recordExportJobSchema.parse(data);
  log.info({ event: "record_export_job", status: payload.format });
}
