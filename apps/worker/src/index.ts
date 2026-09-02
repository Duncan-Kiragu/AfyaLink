import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@kkd/config";
import { processors, startWorkers } from "./start.js";
import { queueNames } from "./queues.js";

export { processors, queueNames };

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
loadDotenv({ path: rootEnv });
loadEnv();

void startWorkers();
