import { analyticsJobSchema } from "@kkd/contracts";
import { createLogger } from "@kkd/observability";

const log = createLogger("worker.analytics");

export async function processAnalytics(data: unknown): Promise<void> {
  const payload = analyticsJobSchema.parse(data);
  log.info({ event: "queue_probe", status: payload.kind });
}
