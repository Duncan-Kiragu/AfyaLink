import type { Redis } from "ioredis";
import {
  channelRedisKeys,
  type NormalizedInboundMessage,
  type OutboundChannelMessage,
} from "@kkd/contracts";
import {
  BaileysWhatsAppAdapter,
  useRedisAuthState,
  type BaileysLogger,
  type WhatsAppConnectionStatus,
} from "@kkd/integrations/whatsapp";
import { createChannelIdentityHasher } from "@kkd/integrations/channel";
import { KkdApiError, type KkdApiClient } from "./api-client.js";
import { SocketLock } from "./socket-lock.js";

/**
 * The WhatsApp gateway.
 *
 * Holds the Baileys socket, forwards inbound messages to the shared
 * conversation engine over the API, and sends the engine's replies back. It
 * deliberately contains no clinical logic and stores no clinical content.
 */

export interface GatewayOptions {
  redis: Redis;
  api: KkdApiClient;
  logger: BaileysLogger;
  identitySalt: string;
  authSlot: string;
  deviceName: string;
  ownerId: string;
  /** How often to drain the proactive outbox. */
  outboxIntervalMs?: number;
  onPairingCode?: (qr: string) => void;
}

export interface GatewayHandle {
  stop: () => Promise<void>;
  status: () => WhatsAppConnectionStatus;
}

/** Adapts ioredis to the hash store shape the Baileys auth state expects. */
function authStore(redis: Redis) {
  return {
    hget: (key: string, fields: string[]) => redis.hmget(key, ...fields),
    hset: async (key: string, entries: Record<string, string>) => {
      await redis.hset(key, entries);
    },
    hdel: async (key: string, fields: string[]) => {
      await redis.hdel(key, ...fields);
    },
    del: async (key: string) => {
      await redis.del(key);
    },
  };
}

export async function startGateway(options: GatewayOptions): Promise<GatewayHandle> {
  // Late-bound: the lock's `onLost` callback needs to stop the gateway, but the
  // handle only exists once the adapter is built.
  const handleRef: { current?: GatewayHandle } = {};

  const lock = new SocketLock({
    redis: options.redis,
    ownerId: options.ownerId,
    onLost: () => {
      options.logger.error(
        { event: "whatsapp_socket_lock_lost" },
        "lost the WhatsApp socket lock; shutting down to avoid a duplicate session",
      );
      // Exiting is correct: two sockets on one credential set log each other
      // out. Render restarts the worker, which then waits for the lock.
      void Promise.resolve(handleRef.current?.stop()).finally(() => process.exit(1));
    },
  });

  const acquired = await lock.acquire();
  if (!acquired) {
    options.logger.warn(
      { event: "whatsapp_socket_lock_busy" },
      "another gateway instance holds the WhatsApp socket; staying idle",
    );
  }

  const hashKey = channelRedisKeys.whatsappAuth(options.authSlot);
  const auth = await useRedisAuthState(authStore(options.redis), hashKey);
  const hasher = createChannelIdentityHasher(options.identitySalt);

  const adapter: BaileysWhatsAppAdapter = new BaileysWhatsAppAdapter({
    auth: auth.state,
    saveCreds: auth.saveCreds,
    clearAuth: auth.clearAll,
    hasher,
    logger: options.logger,
    browserName: options.deviceName,
    ...(options.onPairingCode ? { onPairingCode: options.onPairingCode } : {}),
    onStatusChange: (status) => {
      options.logger.info({ event: "whatsapp_status", status }, "WhatsApp connection status");
    },
    onInbound: (message): Promise<void> => forwardInbound(message, adapter, options),
    onDeliveryStatus: async (event) => {
      await options.api.reportDeliveryStatus(event).catch((error: unknown) => {
        options.logger.warn(
          { event: "whatsapp_status_report_failed", status: describe(error) },
          "could not report delivery status",
        );
      });
    },
  });

  if (acquired) {
    options.logger.info(
      { event: "whatsapp_gateway_starting", status: auth.restored ? "restored" : "fresh" },
      auth.restored
        ? "restored WhatsApp session from Redis"
        : "no stored WhatsApp session; a pairing QR will be emitted",
    );
    await adapter.connect();
  }

  const outboxTimer = setInterval(() => {
    void drainOutbox(adapter, options);
  }, options.outboxIntervalMs ?? 15_000);
  outboxTimer.unref?.();

  handleRef.current = {
    status: () => adapter.getStatus(),
    stop: async () => {
      clearInterval(outboxTimer);
      await adapter.disconnect();
      await lock.release();
    },
  };

  return handleRef.current;
}

async function forwardInbound(
  message: NormalizedInboundMessage,
  adapter: BaileysWhatsAppAdapter,
  options: GatewayOptions,
): Promise<void> {
  let replies: OutboundChannelMessage[];
  try {
    replies = await options.api.submitInbound(message);
  } catch (error) {
    if (error instanceof KkdApiError && error.status === 409) {
      // Another delivery of the same message is already in flight; the reply
      // will be sent by that request.
      return;
    }
    options.logger.error(
      { event: "whatsapp_inbound_forward_failed", status: describe(error) },
      "could not reach the KKD API",
    );
    // The API is the only thing that may author patient-facing text. Rather
    // than inventing a reply here, stay silent and let the patient retry
    // (spec §20 — do not fabricate).
    return;
  }

  // Urgent messages first, so an emergency notice is never queued behind a
  // question (spec §11.7).
  for (const reply of [...replies].sort(
    (a, b) => Number(b.urgent) - Number(a.urgent),
  )) {
    const result = await adapter.send(reply);
    if (!result.accepted) {
      options.logger.warn(
        { event: "whatsapp_reply_undelivered", status: result.failureReason, urgency: undefined },
        "WhatsApp reply was not accepted by the transport",
      );
    }
  }
}

/**
 * Drains proactive sends.
 *
 * Limitation, by design: the adapter can only address a pseudonym it has seen
 * an inbound message from during this process's lifetime. Reaching a patient
 * who has not written recently would require storing a reversible contact
 * address, which on this channel is exactly what the consented profile path is
 * for (spec §11.3F, §8.4A). Until that exists, a proactive send to an unknown
 * pseudonym fails loudly as `unknown_recipient` rather than being guessed at.
 */
async function drainOutbox(
  adapter: BaileysWhatsAppAdapter,
  options: GatewayOptions,
): Promise<void> {
  if (!adapter.isConnected()) return;
  try {
    const messages = await options.api.drainOutbox();
    for (const message of messages) {
      const result = await adapter.send(message);
      if (!result.accepted) {
        options.logger.warn(
          { event: "whatsapp_outbox_undelivered", status: result.failureReason },
          "proactive WhatsApp send was not delivered",
        );
      }
    }
  } catch (error) {
    options.logger.debug(
      { event: "whatsapp_outbox_drain_failed", status: describe(error) },
      "outbox drain skipped",
    );
  }
}

/** Class name / status only. Error messages can quote patient content. */
function describe(error: unknown): string {
  if (error instanceof KkdApiError) return `${error.status}:${error.code}`;
  if (error instanceof Error) return error.name;
  return typeof error;
}
