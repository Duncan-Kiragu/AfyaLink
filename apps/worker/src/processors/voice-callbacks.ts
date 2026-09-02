import { voiceJobPayloadSchema } from "@kkd/contracts";
import { processVoiceJob } from "@kkd/integrations";
import { createLogger } from "@kkd/observability";

const log = createLogger("worker.voice");

export async function processVoiceCallbacks(data: unknown): Promise<void> {
  const payload = voiceJobPayloadSchema.parse(data);
  const result = await processVoiceJob(payload);
  log.info({ event: result.event, status: payload.kind });
}
