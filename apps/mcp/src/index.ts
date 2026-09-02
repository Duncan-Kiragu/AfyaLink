import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { loadEnv } from "@kkd/config";
import { createLogger } from "@kkd/observability";
import { healthApp } from "./health.js";
import { createMcpServer } from "./server.js";

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
loadDotenv({ path: rootEnv });

const env = loadEnv();
const log = createLogger("mcp");
const port = Number.parseInt(process.env.PORT ?? "3100", 10);

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use("/health", healthApp);

createMcpServer();

app.listen(port, () => {
  log.info({ event: "mcp_listen", appEnv: env.APP_ENV, port }, "mcp scaffold listening");
});
