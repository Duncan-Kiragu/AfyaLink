import { recordExportJobSchema, type RecordExportBundle, type RecordExportJob } from "@kkd/contracts";
import { loadEnv } from "@kkd/config";
import { createLogger } from "@kkd/observability";
import { putExportCacheEntry } from "../lib/export-bundle-cache.js";
import { buildRecordExportBundle } from "../lib/record-export-bundle.js";

const log = createLogger("worker.exports");

export type ExportProcessorDeps = {
  buildBundle?: (job: RecordExportJob) => Promise<RecordExportBundle | undefined>;
  putBundle?: (job: RecordExportJob, bundle: RecordExportBundle) => Promise<void>;
};

async function defaultPutBundle(job: RecordExportJob, bundle: RecordExportBundle): Promise<void> {
  const env = loadEnv();
  const ttlSeconds = env.RECORD_EXPORT_TTL_SECONDS;
  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  await putExportCacheEntry({
    job: {
      jobId: job.jobId,
      status: "completed",
      format: "json",
      expiresAt: new Date(expiresAtMs).toISOString(),
    },
    userId: job.userId,
    recordId: job.recordId,
    bundleJson: JSON.stringify(bundle),
    expiresAtMs,
  });
}

export async function processExports(data: unknown, deps: ExportProcessorDeps = {}): Promise<void> {
  const payload = recordExportJobSchema.parse(data);
  const bundle = await (deps.buildBundle ?? buildRecordExportBundle)(payload);
  if (!bundle) {
    log.info({ event: "record_export_job", status: "no_source" });
    return;
  }
  await (deps.putBundle ?? defaultPutBundle)(payload, bundle);
  log.info({ event: "record_export_job", status: payload.format });
}
