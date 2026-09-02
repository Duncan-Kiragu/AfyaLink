import { z } from "zod";
import { channelSchema, localeSchema, sessionModeSchema } from "./common.js";
import { safetyAssessmentSchema } from "./safety.js";
import { kkdSessionSchema } from "./session.js";
import { consultationSummarySchema } from "./ai.js";

/**
 * The channel-neutral conversation port.
 *
 * Every interface (web, WhatsApp, USSD, voice, MCP) drives the conversation
 * through this port. Channels own presentation and interaction state only —
 * fact extraction, urgency, and summary semantics live behind the port so that
 * no channel can grow its own clinical behaviour (spec §3.1, §11.1).
 */

/**
 * What kind of answer the current prompt expects. Channels use this to pick a
 * widget (web), a numbered reply (WhatsApp), or a menu (USSD).
 */
export const promptInputKindSchema = z.enum([
  "free_text",
  "choice",
  "severity_scale",
  "none",
]);
export type PromptInputKind = z.infer<typeof promptInputKindSchema>;

/**
 * A single selectable answer. `labelKey` is a deterministic i18n key and is the
 * only rendering source permitted on safety-critical paths; `label` may carry
 * AI-authored wording for non-critical detail questions.
 */
export const conversationChoiceSchema = z.object({
  id: z.string().min(1),
  labelKey: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  /** Extra locale-specific words that also select this choice (e.g. "ndiyo"). */
  synonyms: z.array(z.string().min(1)).default([]),
});
export type ConversationChoice = z.infer<typeof conversationChoiceSchema>;

export const conversationPromptKindSchema = z.enum([
  /** The AI disclosure. Must be presented before any clinical message. */
  "disclosure",
  /** Choose an interaction language. */
  "language",
  /** A symptom-elicitation question. */
  "question",
  /** An approved safety/urgency message. Deterministic strings only. */
  "safety_notice",
  /** The factual handover summary is available. */
  "summary",
  /** Session finished or purged. */
  "closed",
  /** A degraded-service message. Never fabricates clinical content. */
  "service_notice",
]);
export type ConversationPromptKind = z.infer<typeof conversationPromptKindSchema>;

export const conversationPromptSchema = z.object({
  kind: conversationPromptKindSchema,
  /**
   * Deterministic i18n key from `@kkd/i18n`. Required for `disclosure`,
   * `safety_notice`, `closed`, and `service_notice` so that safety-critical
   * wording is never generated at render time (spec §10.4A).
   */
  messageKey: z.string().min(1).optional(),
  /** Interpolation values for `messageKey`. Never raw patient free text. */
  messageVars: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  /** AI-authored text, already passed through the diagnosis-language guard. */
  text: z.string().optional(),
  inputKind: promptInputKindSchema,
  choices: z.array(conversationChoiceSchema).default([]),
  /** Field id this prompt is trying to fill, for completeness accounting. */
  targetFieldId: z.string().optional(),
  /** True when a red flag fired and the channel must surface it immediately. */
  interrupt: z.boolean().default(false),
});
export type ConversationPrompt = z.infer<typeof conversationPromptSchema>;

/** Degraded-capability flags so channels can adapt without inventing content. */
export const conversationDegradationSchema = z.object({
  aiUnavailable: z.boolean().default(false),
  safetyEngineUnavailable: z.boolean().default(false),
});
export type ConversationDegradation = z.infer<typeof conversationDegradationSchema>;

export const conversationTurnSchema = z.object({
  session: kkdSessionSchema,
  safety: safetyAssessmentSchema,
  prompt: conversationPromptSchema,
  /** Present once the interview has produced a factual handover summary. */
  summary: consultationSummarySchema.optional(),
  degraded: conversationDegradationSchema,
});
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

export const startSessionInputSchema = z.object({
  channel: channelSchema,
  locale: localeSchema.default("en"),
  mode: sessionModeSchema.default("anonymous_ephemeral"),
  /** Pseudonymous channel identity. Never a raw phone number (spec §11.3B). */
  channelUserHash: z.string().min(1).optional(),
});
export type StartSessionInput = z.infer<typeof startSessionInputSchema>;

export const submitMessageInputSchema = z.object({
  sessionId: z.string().min(1),
  /** Patient free text, or the id of a selected choice. */
  text: z.string().max(4000).optional(),
  choiceId: z.string().min(1).optional(),
  /** Locale override when the patient switches language mid-session. */
  locale: localeSchema.optional(),
});
export type SubmitMessageInput = z.infer<typeof submitMessageInputSchema>;

export const acknowledgeDisclosureInputSchema = z.object({
  sessionId: z.string().min(1),
  disclosureVersion: z.string().min(1),
});
export type AcknowledgeDisclosureInput = z.infer<typeof acknowledgeDisclosureInputSchema>;

/**
 * Implemented once, in the API service layer. Channel adapters may not
 * re-implement any of these methods (spec §3.1).
 */
export interface ConversationEngine {
  startSession(input: StartSessionInput): Promise<ConversationTurn>;
  getSession(sessionId: string): Promise<ConversationTurn | null>;
  acknowledgeDisclosure(input: AcknowledgeDisclosureInput): Promise<ConversationTurn>;
  setLocale(sessionId: string, locale: string): Promise<ConversationTurn>;
  submitPatientMessage(input: SubmitMessageInput): Promise<ConversationTurn>;
  getSummary(sessionId: string): Promise<ConversationTurn>;
  closeSession(sessionId: string): Promise<void>;
}

/**
 * A required-question pathway. Owned by the clinical-safety workstream; the
 * channels consume it so that USSD menus and WhatsApp questions stay identical
 * to the web question order.
 */
export const questionFieldSchema = z.object({
  id: z.string().min(1),
  promptKey: z.string().min(1),
  inputKind: promptInputKindSchema,
  choices: z.array(conversationChoiceSchema).default([]),
  /** Critical fields are asked before lower-value detail (spec §8.3B). */
  critical: z.boolean().default(false),
});
export type QuestionField = z.infer<typeof questionFieldSchema>;

export const questionPathwaySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  fields: z.array(questionFieldSchema),
});
export type QuestionPathway = z.infer<typeof questionPathwaySchema>;
