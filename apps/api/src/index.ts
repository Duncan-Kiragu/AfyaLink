import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "@kkd/config";
import { createLogger } from "@kkd/observability";
import { createApp } from "./app.js";

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
loadDotenv({ path: rootEnv });

const env = loadEnv();
const log = createLogger("api");
const app = createApp();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

app.listen(port, () => {
  log.info({ event: "api_listen", appEnv: env.APP_ENV, port }, "api listening");
});
