import type { Redis } from "ioredis";
import type { ConversationEngine } from "@kkd/contracts";
import { createAiServiceFromEnv } from "@kkd/ai";
import {
  DeterministicSafetyEngine,
  RED_FLAGS_V0_1_0_DRAFT_VERSION,
} from "@kkd/clinical-safety";
import { loadEnv, type Env } from "@kkd/config";
import { createChannelIdentityHasher, type ChannelIdentityHasher } from "@kkd/integrations/channel";
import { createPiiServiceFromEnv } from "@kkd/pii";
import { getRedis } from "./redis.js";
import {
  createConversationEngine,
  type ConversationSafetyEngine,
} from "./conversation/engine.js";
import { createSessionStore } from "./conversation/session-store.js";
import { createChannelSessionStore, type ChannelSessionStore } from "./channels/channel-session.js";
import { createIdempotencyStore, type IdempotencyStore } from "./channels/idempotency.js";

function safetyForConversation(env: Env): ConversationSafetyEngine {
  const engine = new DeterministicSafetyEngine({
    executeUnreviewedDraftRules: env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES,
  });
  return {
    evaluate(session) {
      return engine.evaluate({
        symptoms: session.symptoms,
        facts: session.facts,
        priorObservations: [],
        ruleSetVersion: RED_FLAGS_V0_1_0_DRAFT_VERSION,
      });
    },
  };
}

/**
 * Lazily-built application services.
 *
 * Built on first use rather than at import time so that the process can boot
 * (and answer `/health/live`) even when a channel is disabled or Redis is
 * temporarily unreachable. `ChannelsDisabledError` and `ChannelsMisconfigured`
 * are distinct from a runtime outage so operators can tell a missing feature
 * flag from a broken dependency.
 */

export class ChannelsDisabledError extends Error {
  readonly statusCode = 404;
  constructor(channel: string) {
    super(`${channel} channel is disabled`);
    this.name = "ChannelsDisabledError";
  }
}

export class ChannelMisconfiguredError extends Error {
  readonly statusCode = 503;
  constructor(detail: string) {
    super(`channel configuration incomplete: ${detail}`);
    this.name = "ChannelMisconfiguredError";
  }
}

export interface ChannelContext {
  env: Env;
  /** Shared client, exposed so tests can substitute an in-memory Redis. */
  redis: Redis;
  engine: ConversationEngine;
  channelSessions: ChannelSessionStore;
  idempotency: IdempotencyStore;
  hasher: ChannelIdentityHasher;
}

let cached: ChannelContext | undefined;
let cachedEnv: Env | undefined;

export function getEnv(): Env {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

export function getChannelContext(): ChannelContext {
  if (cached) return cached;
  const env = getEnv();

  if (!env.REDIS_URL) {
    throw new ChannelMisconfiguredError("REDIS_URL is not set");
  }

  let hasher: ChannelIdentityHasher;
  try {
    hasher = createChannelIdentityHasher(env.CHANNEL_IDENTITY_SALT);
  } catch {
    throw new ChannelMisconfiguredError("CHANNEL_IDENTITY_SALT is missing or too short");
  }

  const redis = getRedis(env.REDIS_URL);

  const sessions = createSessionStore(redis, {
    ttlSeconds: env.EPHEMERAL_SESSION_TTL_SECONDS,
    maxLifetimeSeconds: env.SESSION_MAX_LIFETIME_SECONDS,
  });

  cached = {
    env,
    redis,
    hasher,
    engine: createConversationEngine({
      sessions,
      ai: createAiServiceFromEnv(env, createPiiServiceFromEnv(env)),
      safety: safetyForConversation(env),
    }),
    channelSessions: createChannelSessionStore(redis, {
      ttlSeconds: env.CHANNEL_SESSION_TTL_SECONDS,
      maxLifetimeSeconds: env.SESSION_MAX_LIFETIME_SECONDS,
      ussdTtlSeconds: env.USSD_SESSION_TTL_SECONDS,
    }),
    // Idempotency records outlive the dialogue they protect so a late provider
    // retry still replays rather than restarting a session.
    idempotency: createIdempotencyStore(redis, env.CHANNEL_SESSION_TTL_SECONDS),
  };
  return cached;
}

export function resetChannelContextForTesting(context?: ChannelContext): void {
  cached = context;
  cachedEnv = context?.env;
}

export function requireWhatsAppEnabled(): ChannelContext {
  const context = getChannelContext();
  if (!context.env.FEATURE_WHATSAPP) throw new ChannelsDisabledError("whatsapp");
  if (!context.env.WHATSAPP_GATEWAY_SECRET) {
    throw new ChannelMisconfiguredError("WHATSAPP_GATEWAY_SECRET is missing");
  }
  return context;
}

export function requireUssdEnabled(): ChannelContext {
  const context = getChannelContext();
  if (!context.env.FEATURE_USSD) throw new ChannelsDisabledError("ussd");
  if (!context.env.USSD_CALLBACK_SECRET) {
    throw new ChannelMisconfiguredError("USSD_CALLBACK_SECRET is missing");
  }
  return context;
}
