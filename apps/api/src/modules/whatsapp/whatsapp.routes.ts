import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  channelRedisKeys,
  deliveryStatusEventSchema,
  normalizedInboundMessageSchema,
  outboundChannelMessageSchema,
} from "@kkd/contracts";
import { createLogger } from "@kkd/observability";
import { requireChannelSignature } from "../../middleware/channel-signature.js";
import { getEnv, requireWhatsAppEnabled } from "../../services/context.js";
import { handleWhatsAppInbound } from "../../services/channels/whatsapp-handler.js";

/**
 * WhatsApp channel routes.
 *
 * These are NOT a public Meta Cloud API webhook. V1 uses Baileys, so inbound
 * WhatsApp traffic arrives over a WebSocket held by `apps/whatsapp`, which then
 * posts the *already normalized* message here over an HMAC-signed hop. Keeping
 * the conversation engine on this side means the gateway holds no clinical
 * logic and can be restarted freely.
 *
 * The reply is returned in the same HTTP response. Safety messaging therefore
 * never waits on a queue (spec §11.7).
 */

const log = createLogger("api.whatsapp");

export const whatsappRouter = Router();

const inboundBodySchema = z.object({
  message: normalizedInboundMessageSchema,
});

const signature = requireChannelSignature(() => getEnv().WHATSAPP_GATEWAY_SECRET);

whatsappRouter.post("/inbound", signature, async (req: Request, res: Response) => {
  const context = requireWhatsAppEnabled();
  const parsed = inboundBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const inbound = parsed.data.message;
  if (inbound.channel !== "whatsapp") {
    res.status(400).json({ error: "invalid_channel" });
    return;
  }

  // Duplicate WhatsApp deliveries must not produce a duplicate user turn
  // (spec §11.3A, §11.6).
  const claim = await context.idempotency.claim("whatsapp", inbound.providerMessageId);
  if (claim.status === "replay") {
    const cached = safeParse(claim.response);
    res.status(200).json(
      cached && typeof cached === "object"
        ? { ...(cached as object), replayed: true }
        : { messages: [], replayed: true },
    );
    return;
  }
  if (claim.status === "in_flight") {
    res.status(409).json({ error: "duplicate_in_flight" });
    return;
  }

  try {
    const reply = await handleWhatsAppInbound(inbound, {
      engine: context.engine,
      channelSessions: context.channelSessions,
      maxLifetimeSeconds: context.env.SESSION_MAX_LIFETIME_SECONDS,
    });

    const payload = {
      messages: reply.messages.map((message) => outboundChannelMessageSchema.parse(message)),
    };
    await context.idempotency.complete(
      "whatsapp",
      inbound.providerMessageId,
      JSON.stringify(payload),
    );

    log.info(
      {
        event: reply.telemetry.event,
        channel: "whatsapp",
        sessionMode: "anonymous_ephemeral",
        language: reply.telemetry.language,
        ...(reply.telemetry.urgency ? { urgency: reply.telemetry.urgency } : {}),
      },
      "whatsapp turn handled",
    );

    res.status(200).json(payload);
  } catch (error) {
    // Release the claim so the gateway's retry is processed rather than
    // silently treated as already handled.
    await context.idempotency.release("whatsapp", inbound.providerMessageId);
    throw error;
  }
});

whatsappRouter.post("/status", signature, async (req: Request, res: Response) => {
  const context = requireWhatsAppEnabled();
  const parsed = deliveryStatusEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  void context;
  // Delivery receipts are operational telemetry only. Storing them per patient
  // would create a message-level record of a health conversation.
  log.info(
    {
      event: "whatsapp_delivery_status",
      channel: "whatsapp",
      status: parsed.data.status,
    },
    "whatsapp delivery status",
  );
  res.status(202).json({ accepted: true });
});

/**
 * Proactive outbound queue. The gateway drains this so the worker can deliver
 * scheduled check-ins without holding a WhatsApp socket of its own. Immediate
 * replies never travel this path.
 */
whatsappRouter.get("/outbox", signature, async (_req: Request, res: Response) => {
  const context = requireWhatsAppEnabled();
  const raw = await context.redis.lpop(channelRedisKeys.whatsappOutbox(), 10);
  const messages = (Array.isArray(raw) ? raw : [])
    .map((entry: string) => outboundChannelMessageSchema.safeParse(safeParse(entry)))
    .flatMap((result) => (result.success ? [result.data] : []));
  res.status(200).json({ messages });
});

whatsappRouter.get("/health", (_req: Request, res: Response) => {
  const env = getEnv();
  res.status(200).json({
    enabled: env.FEATURE_WHATSAPP,
    provider: "baileys",
    configured: Boolean(env.WHATSAPP_GATEWAY_SECRET && env.CHANNEL_IDENTITY_SALT),
  });
});

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
