import type { Express } from "express";
import type {
  ConsultationSummary,
  ConversationEngine,
  KkdAiService,
  QuestionPlan,
  ReportedFacts,
  SafetyAssessment,
} from "@kkd/contracts";
import type { SafetyEngine } from "@kkd/clinical-safety";
import { FakeRedis, asRedis } from "@kkd/testing";
import type { Redis } from "ioredis";
import { loadEnv } from "@kkd/config";
import { createApp } from "../app.js";
import { createConversationEngine } from "../services/conversation/engine.js";
import { createSessionStore } from "../services/conversation/session-store.js";
import { createChannelSessionStore } from "../services/channels/channel-session.js";
import { createIdempotencyStore } from "../services/channels/idempotency.js";
import { resetChannelContextForTesting } from "../services/context.js";
import { createChannelIdentityHasher } from "@kkd/integrations/channel";

/**
 * Wires a real app + real service layer over a fake Redis and controllable
 * AI/safety stubs. The point is that channel tests exercise the actual routes,
 * middleware, and engine rather than a parallel test-only implementation.
 */

export const TEST_SALT = "t".repeat(48);
export const TEST_WHATSAPP_SECRET = "w".repeat(48);
export const TEST_USSD_SECRET = "u".repeat(48);

export interface StubAi extends KkdAiService {
  failExtract: boolean;
  failPlan: boolean;
  failSummary: boolean;
  plannedQuestion: string;
}

export function createStubAi(): StubAi {
  const stub: StubAi = {
    failExtract: false,
    failPlan: false,
    failSummary: false,
    plannedQuestion: "Tell me more about that.",
    async extractReportedFacts(): Promise<ReportedFacts> {
      if (stub.failExtract) throw new Error("claude unavailable");
      return { facts: [], promptId: "extract.v0", promptVersion: "0.0.0", model: "stub" };
    },
    async planNextQuestion(): Promise<QuestionPlan> {
      if (stub.failPlan) throw new Error("claude unavailable");
      return {
        questionId: "q1",
        questionText: stub.plannedQuestion,
        promptId: "plan.v0",
        promptVersion: "0.0.0",
        model: "stub",
      };
    },
    async summarizeSession(): Promise<ConsultationSummary> {
      if (stub.failSummary) throw new Error("claude unavailable");
      return {
        reasonForSeekingCare: "Abdominal pain reported for eight hours.",
        symptomsReported: ["Abdominal pain, lower-right"],
        timeline: "Started approximately eight hours ago.",
        severityAndMeasurements: ["Pain rated 7/10"],
        associatedSymptoms: ["Nausea"],
        symptomsExplicitlyDenied: ["Diarrhoea"],
        medicationAlreadyTaken: [],
        relevantContext: [],
        unknownOrUnanswered: ["Temperature not measured"],
        recommendedNextAction: "Be assessed by a healthcare professional today.",
        urgency: "unknown",
        promptId: "summary.v0",
        promptVersion: "0.0.0",
        model: "stub",
      };
    },
    async normalizeLanguage(input) {
      return { text: input.text, locale: input.localeHint ?? "en" };
    },
  };
  return stub;
}

export interface StubSafety extends SafetyEngine {
  next: SafetyAssessment;
  fail: boolean;
  calls: number;
}

export function assessment(overrides: Partial<SafetyAssessment> = {}): SafetyAssessment {
  return {
    urgency: "monitor",
    ruleIds: ["rule.stub"],
    explanationKeys: [],
    missingCriticalFacts: [],
    requiresHumanEscalation: false,
    ruleSetVersion: "stub.v1",
    ...overrides,
  };
}

export function createStubSafety(): StubSafety {
  const stub: StubSafety = {
    next: assessment(),
    fail: false,
    calls: 0,
    async evaluate(): Promise<SafetyAssessment> {
      stub.calls += 1;
      if (stub.fail) throw new Error("safety engine unavailable");
      return stub.next;
    },
  };
  return stub;
}

export interface ChannelHarness {
  app: Express;
  redis: FakeRedis;
  ai: StubAi;
  safety: StubSafety;
  engine: ConversationEngine;
  dispose: () => void;
}

export interface HarnessOptions {
  whatsapp?: boolean;
  ussd?: boolean;
  identitySalt?: string;
  whatsappSecret?: string;
  ussdSecret?: string;
  sessionTtlSeconds?: number;
  maxLifetimeSeconds?: number;
  ussdTtlSeconds?: number;
}

export function createChannelHarness(options: HarnessOptions = {}): ChannelHarness {
  const redis = new FakeRedis();
  const ai = createStubAi();
  const safety = createStubSafety();

  const env = loadEnv({
    NODE_ENV: "test",
    APP_ENV: "local",
    REDIS_URL: "redis://fake",
    CHANNEL_IDENTITY_SALT: options.identitySalt ?? TEST_SALT,
    WHATSAPP_GATEWAY_SECRET: options.whatsappSecret ?? TEST_WHATSAPP_SECRET,
    USSD_CALLBACK_SECRET: options.ussdSecret ?? TEST_USSD_SECRET,
    EPHEMERAL_SESSION_TTL_SECONDS: String(options.sessionTtlSeconds ?? 1800),
    SESSION_MAX_LIFETIME_SECONDS: String(options.maxLifetimeSeconds ?? 14400),
    CHANNEL_SESSION_TTL_SECONDS: String(options.sessionTtlSeconds ?? 1800),
    USSD_SESSION_TTL_SECONDS: String(options.ussdTtlSeconds ?? 180),
    FEATURE_WHATSAPP: options.whatsapp === false ? "false" : "true",
    FEATURE_USSD: options.ussd === false ? "false" : "true",
  });

  const client = asRedis<Redis>(redis);
  const engine = createConversationEngine({
    sessions: createSessionStore(client, {
      ttlSeconds: env.EPHEMERAL_SESSION_TTL_SECONDS,
      maxLifetimeSeconds: env.SESSION_MAX_LIFETIME_SECONDS,
    }),
    ai,
    safety,
  });

  resetChannelContextForTesting({
    env,
    redis: client,
    engine,
    hasher: createChannelIdentityHasher(env.CHANNEL_IDENTITY_SALT),
    channelSessions: createChannelSessionStore(client, {
      ttlSeconds: env.CHANNEL_SESSION_TTL_SECONDS,
      maxLifetimeSeconds: env.SESSION_MAX_LIFETIME_SECONDS,
      ussdTtlSeconds: env.USSD_SESSION_TTL_SECONDS,
    }),
    idempotency: createIdempotencyStore(client, env.CHANNEL_SESSION_TTL_SECONDS),
  });

  return {
    app: createApp(),
    redis,
    ai,
    safety,
    engine,
    dispose: () => {
      redis.flush();
      resetChannelContextForTesting(undefined);
    },
  };
}
