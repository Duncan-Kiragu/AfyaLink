import { z } from "zod";
import { channelSchema, localeSchema } from "./common.js";
import { conversationChoiceSchema } from "./conversation.js";

export const channelProviderSchema = z.enum(["baileys", "africastalking", "elevenlabs", "twilio"]);
export type ChannelProvider = z.infer<typeof channelProviderSchema>;

export const verifiedInboundEventSchema = z.object({
  provider: channelProviderSchema,
  channel: channelSchema,
  /** Provider-assigned id used for replay protection (spec §11.5). */
  providerMessageId: z.string().min(1),
  /** Keyed hash of the sender identity. Never a raw phone number or JID. */
  channelUserHash: z.string().min(1),
  /** Epoch millis the provider stamped on the event, when available. */
  providerTimestamp: z.number().int().nonnegative().optional(),
  payload: z.unknown(),
});
export type VerifiedInboundEvent = z.infer<typeof verifiedInboundEventSchema>;

/**
 * Why an inbound message carries no usable text. Channels answer with an
 * approved deterministic message rather than forwarding the content anywhere
 * (spec §11.3E — no silent media processing).
 */
export const inboundRejectionSchema = z.enum([
  "unsupported_media",
  "empty_message",
  "too_long",
]);
export type InboundRejection = z.infer<typeof inboundRejectionSchema>;

export const normalizedInboundMessageSchema = z.object({
  channel: channelSchema,
  provider: channelProviderSchema,
  channelUserHash: z.string().min(1),
  providerMessageId: z.string().min(1),
  /** Patient free text. Absent when `rejection` is set. */
  text: z.string().optional(),
  /** Set when the patient tapped a rendered choice or typed its number. */
  choiceId: z.string().optional(),
  /** Locale hint from the channel. Only ever a hint (spec §10.4B). */
  locale: localeSchema.optional(),
  rejection: inboundRejectionSchema.optional(),
  /** Provider session id hash — USSD only; WhatsApp has no provider session. */
  providerSessionIdHash: z.string().optional(),
});
export type NormalizedInboundMessage = z.infer<typeof normalizedInboundMessageSchema>;

/**
 * A channel-neutral outbound message. Adapters decide how to render `choices`:
 * native interactive controls where the transport supports them, otherwise a
 * deterministic numbered list.
 */
export const outboundChannelMessageSchema = z.object({
  channel: channelSchema,
  channelUserHash: z.string().min(1),
  /** Fully localized body text. */
  text: z.string().min(1),
  choices: z.array(conversationChoiceSchema).default([]),
  /** Rendered choice labels, resolved by the caller in the target locale. */
  choiceLabels: z.record(z.string(), z.string()).default({}),
  locale: localeSchema.default("en"),
  /** True for red-flag/urgent output; adapters must not batch or delay it. */
  urgent: z.boolean().default(false),
  /** Terminates the channel interaction (USSD `END`, WhatsApp closing note). */
  terminal: z.boolean().default(false),
  /** Correlates the send with the inbound message it answers. */
  replyToProviderMessageId: z.string().optional(),
});
export type OutboundChannelMessage = z.infer<typeof outboundChannelMessageSchema>;

export const deliveryResultSchema = z.object({
  accepted: z.boolean(),
  providerMessageId: z.string().optional(),
  /** Safe failure reason. Never contains message content. */
  failureReason: z.string().optional(),
});
export type DeliveryResult = z.infer<typeof deliveryResultSchema>;

export const deliveryStatusSchema = z.enum(["pending", "sent", "delivered", "read", "failed"]);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const deliveryStatusEventSchema = z.object({
  channel: channelSchema,
  provider: channelProviderSchema,
  providerMessageId: z.string().min(1),
  status: deliveryStatusSchema,
  at: z.string(),
});
export type DeliveryStatusEvent = z.infer<typeof deliveryStatusEventSchema>;

export interface ConversationChannelAdapter {
  verifyInbound(request: unknown): Promise<VerifiedInboundEvent>;
  normalizeInbound(event: VerifiedInboundEvent): Promise<NormalizedInboundMessage>;
  send(message: OutboundChannelMessage): Promise<DeliveryResult>;
}

/**
 * Redis-held mapping between a pseudonymous channel identity and an ephemeral
 * KKD session. Expires with the session; never written to Supabase.
 */
export const channelSessionSchema = z.object({
  channel: channelSchema,
  channelUserHash: z.string().min(1),
  sessionId: z.string().min(1),
  locale: localeSchema,
  disclosureVersion: z.string().min(1),
  disclosureAcknowledgedAt: z.string().optional(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
  /** Hard stop independent of sliding TTL (spec §4.3E). */
  expiresAt: z.string(),
});
export type ChannelSession = z.infer<typeof channelSessionSchema>;

export const channelRedisKeys = {
  /** Channel identity -> session id. */
  identity: (channel: string, channelUserHash: string) =>
    `kkd:channel:${channel}:identity:${channelUserHash}`,
  /** Replay protection for a provider message id. */
  idempotency: (channel: string, providerMessageId: string) =>
    `kkd:channel:${channel}:idem:${providerMessageId}`,
  /** USSD provider session state. */
  ussdState: (providerSessionIdHash: string) => `kkd:channel:ussd:state:${providerSessionIdHash}`,
  /** Baileys credential + Signal key store. */
  whatsappAuth: (slot: string) => `kkd:channel:whatsapp:auth:${slot}`,
  /** Single-writer lock so only one process holds the WhatsApp socket. */
  whatsappSocketLock: () => `kkd:lock:channel:whatsapp:socket`,
  /** Outbox the gateway drains for proactive (non-reply) sends. */
  whatsappOutbox: () => `kkd:channel:whatsapp:outbox`,
} as const;

export const voiceHandoffStateSchema = z.enum([
  "requested",
  "consented",
  "queued",
  "clinician_assigned",
  "calling",
  "connected",
  "completed",
  "failed",
  "cancelled",
]);
export type VoiceHandoffState = z.infer<typeof voiceHandoffStateSchema>;
