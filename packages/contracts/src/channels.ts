import { z } from "zod";
import { channelSchema, localeSchema } from "./common.js";

export const verifiedInboundEventSchema = z.object({
  provider: z.enum(["whatsapp", "ussd", "voice", "twilio"]),
  providerMessageId: z.string(),
  channelUserHash: z.string(),
  payload: z.unknown(),
});
export type VerifiedInboundEvent = z.infer<typeof verifiedInboundEventSchema>;

export const normalizedInboundMessageSchema = z.object({
  channel: channelSchema,
  channelUserHash: z.string(),
  text: z.string().optional(),
  locale: localeSchema.optional(),
  providerMessageId: z.string(),
});
export type NormalizedInboundMessage = z.infer<typeof normalizedInboundMessageSchema>;

export const outboundChannelMessageSchema = z.object({
  channel: channelSchema,
  channelUserHash: z.string(),
  text: z.string(),
});
export type OutboundChannelMessage = z.infer<typeof outboundChannelMessageSchema>;

export const deliveryResultSchema = z.object({
  accepted: z.boolean(),
  providerMessageId: z.string().optional(),
});
export type DeliveryResult = z.infer<typeof deliveryResultSchema>;

export interface ConversationChannelAdapter {
  verifyInbound(request: unknown): Promise<VerifiedInboundEvent>;
  normalizeInbound(event: VerifiedInboundEvent): Promise<NormalizedInboundMessage>;
  send(message: OutboundChannelMessage): Promise<DeliveryResult>;
}

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
