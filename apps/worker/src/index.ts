import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@kkd/config";
import { createLogger } from "@kkd/observability";
import { processAnalytics } from "./processors/analytics.js";
import { processExports } from "./processors/exports.js";
import { processFollowups } from "./processors/followups.js";
import { processNotifications } from "./processors/notifications.js";
import { processProviderSync } from "./processors/provider-sync.js";
import { processPurges } from "./processors/purges.js";
import { processVoiceCallbacks, startVoiceCallbackWorker } from "./processors/voice-callbacks.js";
import { queueNames } from "./queues.js";

export const processors = {
  followups: processFollowups,
  notifications: processNotifications,
  "provider-sync": processProviderSync,
  "voice-callbacks": processVoiceCallbacks,
  exports: processExports,
  purges: processPurges,
  analytics: processAnalytics,
} as const;

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
loadDotenv({ path: rootEnv });

const env = loadEnv();
const log = createLogger("worker");

log.info(
  {
    event: "worker_boot",
    appEnv: env.APP_ENV,
    queues: queueNames,
    processorCount: Object.keys(processors).length,
  },
  "worker started",
);

startVoiceCallbackWorker();

setInterval(() => {
  log.info({ event: "worker_heartbeat" }, "worker idle");
}, 30_000);
