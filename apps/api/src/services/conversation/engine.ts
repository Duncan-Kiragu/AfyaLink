import {
  type AcknowledgeDisclosureInput,
  type ConversationDegradation,
  type ConversationEngine,
  type ConversationPrompt,
  type ConversationTurn,
  type KkdAiService,
  type QuestionField,
  type SafetyAssessment,
  type StartSessionInput,
  type SubmitMessageInput,
} from "@kkd/contracts";
import type { SafetyEngine } from "@kkd/clinical-safety";
import { resolveLocale } from "@kkd/i18n";
import { createLogger } from "@kkd/observability";
import { CURRENT_DISCLOSURE_VERSION, isDisclosureCurrent } from "../disclosure.js";
import {
  completenessPercent,
  getPathway,
  missingFieldIds,
  nextUnansweredField,
} from "./question-pathway.js";
import { unknownSafety, type SessionStore, type StoredSession } from "./session-store.js";

/**
 * The shared conversation engine.
 *
 * This is the single implementation of the KKD session flow (spec §5.3). Web,
 * WhatsApp, USSD, voice, and MCP all drive it; none of them may re-implement
 * any part of it (spec §3.1, §11.1).
 *
 * Two engines are injected and both are allowed to be unavailable:
 *  - `ai` (Claude) shapes question wording and the summary. If it fails, the
 *    interview continues from the deterministic question pathway and the turn
 *    is flagged `aiUnavailable` rather than fabricating content (spec §20).
 *  - `safety` decides urgency. If it fails, urgency is *not* guessed: the turn
 *    returns the conservative approved failure message (spec §20, §8.3C).
 *
 * The engine never asks the AI for an urgency class and never lets a caller
 * skip the safety step, so there is no `skipSafety` path to abuse (spec §13.4E).
 */

const log = createLogger("api.conversation");

export interface ConversationEngineDeps {
  sessions: SessionStore;
  ai: KkdAiService;
  safety: SafetyEngine;
  /** Rejects diagnostic assertion/speculation in model output (spec §14). */
  guard?: DiagnosisGuard;
}

export interface DiagnosisGuard {
  /** Returns safe text, or `undefined` when the text must be suppressed. */
  filter(text: string, locale: string): Promise<string | undefined>;
}

export class SessionNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super("session not found or expired");
    this.name = "SessionNotFoundError";
  }
}

export class DisclosureRequiredError extends Error {
  readonly statusCode = 428;
  constructor() {
    super("AI disclosure must be acknowledged before the first clinical message");
    this.name = "DisclosureRequiredError";
  }
}

export function createConversationEngine(deps: ConversationEngineDeps): ConversationEngine {
  const { sessions, ai, safety } = deps;

  /** Runs the deterministic safety engine. Never substitutes an AI opinion. */
  async function evaluateSafety(session: StoredSession): Promise<{
    safety: SafetyAssessment;
    unavailable: boolean;
  }> {
    try {
      return { safety: await safety.evaluate(session), unavailable: false };
    } catch (error) {
      log.error(
        { event: "safety_engine_unavailable", channel: session.channel, sessionMode: session.mode },
        "safety evaluation failed; returning conservative unknown",
      );
      void error;
      return {
        // Conservative: unknown urgency plus human escalation, not reassurance.
        safety: { ...unknownSafety(), requiresHumanEscalation: true },
        unavailable: true,
      };
    }
  }

  /** Asks Claude to word the next question; falls back to the reviewed key. */
  async function wordQuestion(
    session: StoredSession,
    field: QuestionField,
  ): Promise<{ prompt: ConversationPrompt; aiUnavailable: boolean }> {
    const base: ConversationPrompt = {
      kind: "question",
      messageKey: field.promptKey,
      inputKind: field.inputKind,
      choices: field.choices,
      targetFieldId: field.id,
      interrupt: false,
    };

    try {
      const plan = await ai.planNextQuestion({
        sessionId: session.id,
        locale: session.locale,
        missingFieldIds: missingFieldIds(getPathway(session.answers.symptom_category), [
          ...session.answeredFieldIds,
        ]),
      });
      const safeText = deps.guard
        ? await deps.guard.filter(plan.questionText, session.locale)
        : plan.questionText;
      if (!safeText) return { prompt: base, aiUnavailable: false };
      // Keep `messageKey` alongside the AI wording so a channel that must use
      // reviewed strings can still render the question.
      return { prompt: { ...base, text: safeText }, aiUnavailable: false };
    } catch {
      // Not an error condition for the patient: the reviewed question stands.
      log.warn({ event: "ai_question_unavailable", channel: session.channel }, "using pathway key");
      return { prompt: base, aiUnavailable: true };
    }
  }

  function toTurn(
    session: StoredSession,
    prompt: ConversationPrompt,
    degraded: ConversationDegradation,
  ): ConversationTurn {
    return {
      session: {
        id: session.id,
        mode: session.mode,
        channel: session.channel,
        locale: session.locale,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        disclosureVersion: session.disclosureVersion,
        facts: session.facts,
        symptoms: session.symptoms,
        safety: session.safety,
        completion: session.completion,
      },
      safety: session.safety,
      prompt,
      degraded,
    };
  }

  function disclosurePrompt(session: StoredSession): ConversationPrompt {
    return {
      kind: "disclosure",
      messageKey:
        session.channel === "whatsapp"
          ? "channel.disclosure.whatsapp"
          : session.channel === "ussd"
            ? "channel.disclosure.ussd"
            : "disclosure.body",
      inputKind: "choice",
      choices: [{ id: "acknowledge", labelKey: "disclosure.acknowledge", synonyms: ["1", "ok"] }],
      interrupt: false,
    };
  }

  async function requireSession(sessionId: string): Promise<StoredSession> {
    const session = await sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError();
    return session;
  }

  async function nextTurn(
    session: StoredSession,
    degraded: ConversationDegradation,
  ): Promise<ConversationTurn> {
    const { safety: assessment, unavailable } = await evaluateSafety(session);
    const withSafety: StoredSession = { ...session, safety: assessment };
    const nowDegraded: ConversationDegradation = {
      ...degraded,
      safetyEngineUnavailable: degraded.safetyEngineUnavailable || unavailable,
    };

    // Red flag first: the approved safety message interrupts questioning and is
    // produced synchronously, never behind a queue (spec §8.3B, §11.7).
    if (assessment.urgency === "emergency" || assessment.requiresHumanEscalation) {
      const saved = await sessions.save(withSafety);
      return toTurn(
        saved,
        {
          kind: "safety_notice",
          messageKey: nowDegraded.safetyEngineUnavailable
            ? "channel.safety.unavailable"
            : "channel.safety.emergency",
          inputKind: "none",
          choices: [],
          interrupt: true,
        },
        nowDegraded,
      );
    }

    const pathway = getPathway(withSafety.answers.symptom_category);
    const field = nextUnansweredField(pathway, withSafety.answeredFieldIds);

    const progressed: StoredSession = {
      ...withSafety,
      pathwayId: pathway.id,
      completion: {
        percent: completenessPercent(pathway, withSafety.answeredFieldIds),
        missingFieldIds: missingFieldIds(pathway, withSafety.answeredFieldIds),
      },
    };

    if (!field) {
      // Interview complete: hand back the urgency disposition and signal that a
      // factual summary can be produced.
      const saved = await sessions.save({ ...progressed, pendingFieldId: undefined });
      return toTurn(
        saved,
        {
          kind: "summary",
          messageKey: urgencyMessageKey(assessment.urgency, nowDegraded),
          inputKind: "none",
          choices: [],
          interrupt: false,
        },
        nowDegraded,
      );
    }

    const { prompt, aiUnavailable } = await wordQuestion(progressed, field);
    const saved = await sessions.save({ ...progressed, pendingFieldId: field.id });
    return toTurn(saved, prompt, {
      ...nowDegraded,
      aiUnavailable: nowDegraded.aiUnavailable || aiUnavailable,
    });
  }

  return {
    async startSession(input: StartSessionInput) {
      const session = await sessions.create({
        channel: input.channel,
        mode: input.mode,
        locale: resolveLocale(input.locale),
        disclosureVersion: CURRENT_DISCLOSURE_VERSION,
        ...(input.channelUserHash === undefined
          ? {}
          : { channelUserHash: input.channelUserHash }),
      });
      // No clinical interaction proceeds before disclosure (spec §1.1.8, §15).
      return toTurn(session, disclosurePrompt(session), {
        aiUnavailable: false,
        safetyEngineUnavailable: false,
      });
    },

    async getSession(sessionId) {
      const session = await sessions.get(sessionId);
      if (!session) return null;
      if (!session.disclosureAcknowledgedAt) {
        return toTurn(session, disclosurePrompt(session), {
          aiUnavailable: false,
          safetyEngineUnavailable: false,
        });
      }
      // Re-present the question that is actually outstanding, with its own
      // input kind and choices, so a channel resuming a session renders the
      // same widget/menu the patient saw before.
      const pending = session.pendingFieldId
        ? getPathway(session.answers.symptom_category).fields.find(
            (field) => field.id === session.pendingFieldId,
          )
        : undefined;
      const prompt: ConversationPrompt = pending
        ? {
            kind: "question",
            messageKey: pending.promptKey,
            inputKind: pending.inputKind,
            choices: pending.choices,
            targetFieldId: pending.id,
            interrupt: false,
          }
        : {
            kind: "question",
            messageKey: "channel.prompt.describe",
            inputKind: "free_text",
            choices: [],
            interrupt: false,
          };
      return toTurn(session, prompt, { aiUnavailable: false, safetyEngineUnavailable: false });
    },

    async acknowledgeDisclosure(input: AcknowledgeDisclosureInput) {
      const session = await requireSession(input.sessionId);
      if (!isDisclosureCurrent(input.disclosureVersion)) {
        // A stale acknowledgement is not an acknowledgement; re-present it.
        return toTurn(session, disclosurePrompt(session), {
          aiUnavailable: false,
          safetyEngineUnavailable: false,
        });
      }
      const acknowledged = await sessions.save({
        ...session,
        disclosureVersion: input.disclosureVersion,
        disclosureAcknowledgedAt: new Date().toISOString(),
      });
      return nextTurn(acknowledged, { aiUnavailable: false, safetyEngineUnavailable: false });
    },

    async setLocale(sessionId, locale) {
      const session = await requireSession(sessionId);
      // Language changes mid-session must not reset collected facts; the
      // normalized concepts are language-neutral (spec §10.4B).
      const updated = await sessions.save({ ...session, locale: resolveLocale(locale) });
      if (!updated.disclosureAcknowledgedAt) {
        return toTurn(updated, disclosurePrompt(updated), {
          aiUnavailable: false,
          safetyEngineUnavailable: false,
        });
      }
      return nextTurn(updated, { aiUnavailable: false, safetyEngineUnavailable: false });
    },

    async submitPatientMessage(input: SubmitMessageInput) {
      const session = await requireSession(input.sessionId);
      if (!session.disclosureAcknowledgedAt) throw new DisclosureRequiredError();

      const withLocale: StoredSession =
        input.locale === undefined
          ? session
          : { ...session, locale: resolveLocale(input.locale) };

      const answer = input.choiceId ?? input.text;
      if (answer === undefined || answer.trim().length === 0) {
        // Nothing new to record — re-ask the current question.
        return nextTurn(withLocale, { aiUnavailable: false, safetyEngineUnavailable: false });
      }

      const fieldId = withLocale.pendingFieldId;
      const answered: StoredSession = {
        ...withLocale,
        ...(fieldId
          ? {
              answers: { ...withLocale.answers, [fieldId]: answer },
              answeredFieldIds: withLocale.answeredFieldIds.includes(fieldId)
                ? withLocale.answeredFieldIds
                : [...withLocale.answeredFieldIds, fieldId],
            }
          : {}),
      };

      const extracted = await extractFacts(ai, answered, answer);
      const saved = await sessions.save({
        ...answered,
        facts: [...answered.facts, ...extracted.facts],
      });
      return nextTurn(saved, {
        aiUnavailable: extracted.unavailable,
        safetyEngineUnavailable: false,
      });
    },

    async getSummary(sessionId) {
      const session = await requireSession(sessionId);
      if (!session.disclosureAcknowledgedAt) throw new DisclosureRequiredError();
      const { safety: assessment, unavailable } = await evaluateSafety(session);
      const degraded: ConversationDegradation = {
        aiUnavailable: false,
        safetyEngineUnavailable: unavailable,
      };

      try {
        const summary = await ai.summarizeSession({
          sessionId: session.id,
          locale: session.locale,
          channel: session.channel,
        });
        const saved = await sessions.save({ ...session, safety: assessment });
        return {
          ...toTurn(
            saved,
            {
              kind: "summary",
              messageKey: "channel.summary.ready",
              inputKind: "none",
              choices: [],
              interrupt: false,
            },
            degraded,
          ),
          // Urgency always comes from the rule engine, never from the model's
          // own summary field (spec §6.3D, §8.3A).
          summary: { ...summary, urgency: assessment.urgency },
        };
      } catch {
        const saved = await sessions.save({ ...session, safety: assessment });
        return toTurn(
          saved,
          {
            kind: "service_notice",
            messageKey: "channel.summary.unavailable",
            inputKind: "none",
            choices: [],
            interrupt: false,
          },
          { ...degraded, aiUnavailable: true },
        );
      }
    },

    async closeSession(sessionId) {
      await sessions.destroy(sessionId);
    },
  };
}

async function extractFacts(
  ai: KkdAiService,
  session: StoredSession,
  patientText: string,
): Promise<{ facts: StoredSession["facts"]; unavailable: boolean }> {
  try {
    const result = await ai.extractReportedFacts({
      sessionId: session.id,
      locale: session.locale,
      patientText,
      existingFactIds: session.facts.map((fact) => fact.id),
    });
    return { facts: result.facts, unavailable: false };
  } catch {
    // The answer is still recorded against its pathway field; only the
    // normalized fact extraction is missing.
    return { facts: [], unavailable: true };
  }
}

function urgencyMessageKey(
  urgency: SafetyAssessment["urgency"],
  degraded: ConversationDegradation,
): string {
  if (degraded.safetyEngineUnavailable) return "channel.safety.unavailable";
  switch (urgency) {
    case "emergency":
      return "channel.safety.emergency";
    case "urgent_today":
      return "channel.safety.urgentToday";
    case "soon":
      return "channel.safety.soon";
    case "monitor":
      return "channel.safety.monitor";
    default:
      return "channel.safety.unknown";
  }
}
