import cors from "cors";
import { loadEnv } from "@kkd/config";

export function createCors() {
  const env = loadEnv();
  return cors({
    origin: env.WEB_BASE_URL,
    credentials: true,
  });
}
