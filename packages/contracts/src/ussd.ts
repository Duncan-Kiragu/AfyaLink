import { z } from "zod";
import { localeSchema } from "./common.js";
import { conversationChoiceSchema } from "./conversation.js";

/**
 * USSD is a deterministic state machine, not a free-form chatbot (spec §11.4).
 *
 * The spec's V1 flow is
 *   disclosure -> language -> primary symptom category
 *   -> high-value structured questions -> immediate safety checks
 *   -> urgency/next action -> optional summary via another channel.
 *
 * The first two steps are channel-owned. From `conversation` onward the screens
 * are rendered from prompts the *shared* conversation engine emits, so the
 * symptom category and the structured questions are the same question pathway
 * the web and WhatsApp use. A USSD-local question tree would be a second
 * clinical implementation, which §3.1 forbids.
 */
export const ussdStepSchema = z.enum([
  /** Compressed AI disclosure plus language choice. */
  "disclosure",
  /** Language change requested mid-dialogue. */
  "language",
  /** Symptom category and structured questions, driven by the shared engine. */
  "conversation",
  /** Approved urgency/next-action screen. */
  "safety_outcome",
  /** Offer to receive the factual summary on another channel. */
  "summary_delivery",
  "done",
]);
export type UssdStep = z.infer<typeof ussdStepSchema>;

export const ussdSessionStateSchema = z.object({
  /** Keyed hash of the provider session id. The raw id is never stored. */
  providerSessionIdHash: z.string().min(1),
  /** Pseudonymous caller identity. Never a raw phone number. */
  channelUserHash: z.string().min(1),
  /** Ephemeral KKD session this USSD dialogue drives. */
  sessionId: z.string().min(1),
  currentStep: ussdStepSchema,
  locale: localeSchema,
  disclosureVersion: z.string().min(1),
  disclosureAcknowledged: z.boolean().default(false),
  /**
   * Choices rendered on the previous screen. A keypress resolves against what
   * the caller actually saw, not against whatever the engine would ask next.
   */
  pendingChoices: z.array(conversationChoiceSchema).default([]),
  pendingChoiceLabels: z.record(z.string(), z.string()).default({}),
  /** Field the previous screen was trying to fill, for completeness reporting. */
  pendingFieldId: z.string().optional(),
  /** Screens served so far, checked against the interaction-depth budget. */
  screenCount: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type UssdSessionState = z.infer<typeof ussdSessionStateSchema>;

/** Africa's Talking-shaped callback body, the V1 supported provider. */
export const ussdProviderRequestSchema = z.object({
  sessionId: z.string().min(1),
  serviceCode: z.string().optional(),
  phoneNumber: z.string().min(1),
  /**
   * Accumulated input joined with `*`. Empty string on the first hit. The
   * adapter reads only the final segment and relies on Redis for real state,
   * so providers that do not accumulate work unchanged.
   */
  text: z.string().default(""),
  networkCode: z.string().optional(),
});
export type UssdProviderRequest = z.infer<typeof ussdProviderRequestSchema>;

export const ussdResponseKindSchema = z.enum(["continue", "end"]);
export type UssdResponseKind = z.infer<typeof ussdResponseKindSchema>;

export const ussdResponseSchema = z.object({
  kind: ussdResponseKindSchema,
  text: z.string().min(1),
});
export type UssdResponse = z.infer<typeof ussdResponseSchema>;

/**
 * Per-provider screen budget. Africa's Talking documents 182 characters per
 * USSD screen; the `CON `/`END ` prefix is reserved out of it.
 */
export const USSD_MAX_SCREEN_CHARS = 182;
export const USSD_PREFIX_CHARS = 4;
export const USSD_MAX_BODY_CHARS = USSD_MAX_SCREEN_CHARS - USSD_PREFIX_CHARS;

/** USSD dialogues are short-lived; aggregators typically time out under 3 min. */
export const USSD_DEFAULT_TTL_SECONDS = 180;

/**
 * Screens a single dialogue may serve before we stop pretending the interview
 * can be completed here and hand the caller to a professional (spec §11.4C).
 */
export const USSD_MAX_SCREENS = 12;
