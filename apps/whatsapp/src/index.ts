import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import qrcode from "qrcode-terminal";
import { loadEnv } from "@kkd/config";
import { createLogger } from "@kkd/observability";
import { KkdApiClient } from "./api-client.js";
import { startGateway } from "./gateway.js";

/**
 * KKD WhatsApp gateway (Baileys).
 *
 * Deployed as a Render *background worker*, not a web service: it holds one
 * long-lived WebSocket and one WhatsApp linked-device session, so it must not
 * be horizontally scaled. A Redis lock enforces that even if it is.
 */

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
loadDotenv({ path: rootEnv });

const env = loadEnv();
const log = createLogger("whatsapp-gateway");

if (!env.FEATURE_WHATSAPP) {
  log.warn({ event: "whatsapp_gateway_disabled" }, "FEATURE_WHATSAPP is false; not connecting");
  process.exit(0);
}

for (const [name, value] of [
  ["REDIS_URL", env.REDIS_URL],
  ["CHANNEL_IDENTITY_SALT", env.CHANNEL_IDENTITY_SALT],
  ["WHATSAPP_GATEWAY_SECRET", env.WHATSAPP_GATEWAY_SECRET],
] as const) {
  if (!value) {
    // Fail at boot rather than run an unauthenticated or unhashable channel.
    log.fatal({ event: "whatsapp_gateway_misconfigured", status: name }, `${name} is required`);
    process.exit(1);
  }
}

const redis = new Redis(env.REDIS_URL as string, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
});

/**
 * Baileys is chatty and its trace/debug output includes message contents, so
 * its logger is pinned to `warn` outside local development. `@kkd/observability`
 * additionally redacts the known content fields.
 */
const baileysLogger = createLogger("whatsapp-gateway.baileys");
baileysLogger.level = env.APP_ENV === "local" ? env.LOG_LEVEL : "warn";

const gateway = await startGateway({
  redis,
  api: new KkdApiClient({
    baseUrl: env.API_BASE_URL,
    secret: env.WHATSAPP_GATEWAY_SECRET as string,
  }),
  logger: baileysLogger,
  identitySalt: env.CHANNEL_IDENTITY_SALT as string,
  authSlot: env.WHATSAPP_AUTH_SLOT,
  deviceName: env.WHATSAPP_DEVICE_NAME,
  // Stable per deploy so a restart can re-take its own lock immediately.
  ownerId: `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
  onPairingCode: (qr) => {
    // The QR is only useful to whoever is watching this log right now, and it
    // authorizes a device rather than exposing patient data.
    log.warn(
      { event: "whatsapp_pairing_required" },
      "scan the QR below with the KKD operator phone (WhatsApp > Linked devices)",
    );
    qrcode.generate(qr, { small: true });
  },
});

log.info(
  { event: "whatsapp_gateway_started", channel: "whatsapp", status: gateway.status() },
  "WhatsApp gateway running",
);

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ event: "whatsapp_gateway_stopping", status: signal }, "shutting down");
    void gateway
      .stop()
      .then(() => redis.quit())
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
}
