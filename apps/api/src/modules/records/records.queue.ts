import {
  recordExportJobSchema,
  recordPurgeVerifyJobSchema,
  type RecordExportJob,
  type RecordPurgeVerifyJob,
} from "@kkd/contracts";
import { createLogger } from "@kkd/observability";
import { enqueueOnQueue } from "../../services/queues.js";

const log = createLogger("records.queue");

export async function enqueueRecordJob(
  payload: RecordExportJob | RecordPurgeVerifyJob,
): Promise<void> {
  const parsed =
    payload.kind === "record_export"
      ? recordExportJobSchema.parse(payload)
      : recordPurgeVerifyJobSchema.parse(payload);
  const queueName = parsed.kind === "record_export" ? "exports" : "purges";
  const result = await enqueueOnQueue(queueName, parsed.kind, parsed, parsed.idempotencyKey);
  if (result === "queued") {
    log.info({ event: "record_job_queued", status: parsed.kind });
    return;
  }
  log.info({
    event: result === "skipped" ? "record_job_in_process" : "record_job_fallback",
    status: parsed.kind,
  });
}
