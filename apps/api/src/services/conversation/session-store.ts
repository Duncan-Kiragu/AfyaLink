import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { z } from "zod";
import {
  kkdSessionSchema,
  redisKeyPrefixes,
  type Channel,
  type KkdSession,
  type SafetyAssessment,
  type SessionMode,
} from "@kkd/contracts";

/**
 * Ephemeral session storage for the shared conversation engine.
 *
 * Clinic/anonymous sessions live only in Redis with a mandatory TTL and a hard
 * lifetime cap; nothing here is written to Supabase and nothing is logged
 * (spec §1.1.6, §4.3E, §16.1).
 */

/** Fields the engine tracks alongside the public session contract. */
export interface StoredSession extends KkdSession {
  /** Set once the channel has presented and the patient acknowledged. */
  disclosureAcknowledgedAt?: string;
  /** Hard stop independent of the sliding TTL. */
  expiresAt: string;
  /** Pseudonymous channel identity, when the session came from a channel. */
  channelUserHash?: string;
  /** Question field the last prompt was trying to fill. */
  pendingFieldId?: string;
  /** Field ids answered so far, for completeness accounting. */
  answeredFieldIds: string[];
  /** Answers keyed by field id. Short patient-supplied values only. */
  answers: Record<string, string>;
  /** Question pathway currently driving the interview. */
  pathwayId?: string;
}

export interface SessionStoreOptions {
  ttlSeconds: number;
  maxLifetimeSeconds: number;
  now?: () => Date;
}

export interface SessionStore {
  create(input: {
    channel: Channel;
    mode: SessionMode;
    locale: string;
    disclosureVersion: string;
    channelUserHash?: string;
  }): Promise<StoredSession>;
  get(sessionId: string): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<StoredSession>;
  /** Deletes the session content immediately (spec §16.1). */
  destroy(sessionId: string): Promise<void>;
}

/**
 * The pre-evaluation safety state. `unknown` is deliberate: an unevaluated
 * session must never look reassuring (spec §8.3C).
 */
export function unknownSafety(): SafetyAssessment {
  return {
    urgency: "unknown",
    ruleIds: [],
    explanationKeys: [],
    missingCriticalFacts: [],
    requiresHumanEscalation: false,
    ruleSetVersion: "unevaluated",
  };
}

export function createSessionStore(redis: Redis, options: SessionStoreOptions): SessionStore {
  const now = options.now ?? (() => new Date());
  const key = (sessionId: string) => redisKeyPrefixes.session(sessionId);

  const remainingTtl = (session: StoredSession, at: Date): number => {
    const hardStop = Date.parse(session.expiresAt) - at.getTime();
    return Math.max(0, Math.min(options.ttlSeconds, Math.ceil(hardStop / 1000)));
  };

  return {
    async create(input) {
      const at = now();
      const session: StoredSession = {
        // Opaque id; carries no channel or patient information.
        id: randomUUID(),
        mode: input.mode,
        channel: input.channel,
        locale: input.locale,
        createdAt: at.toISOString(),
        lastActivityAt: at.toISOString(),
        disclosureVersion: input.disclosureVersion,
        facts: [],
        symptoms: [],
        safety: unknownSafety(),
        completion: { percent: 0, missingFieldIds: [] },
        expiresAt: new Date(at.getTime() + options.maxLifetimeSeconds * 1000).toISOString(),
        answeredFieldIds: [],
        answers: {},
        ...(input.channelUserHash === undefined
          ? {}
          : { channelUserHash: input.channelUserHash }),
      };
      // A session that cannot be stored must not be handed back as usable: the
      // TTL and purge guarantees would not hold (spec §20, Redis unavailable).
      await redis.set(key(session.id), JSON.stringify(session), "EX", options.ttlSeconds);
      return session;
    },

    async get(sessionId) {
      const raw = await redis.get(key(sessionId));
      if (!raw) return null;
      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(raw);
      } catch {
        await redis.del(key(sessionId));
        return null;
      }
      const parsed = storedSessionSchema.safeParse(parsedRaw);
      if (!parsed.success) {
        await redis.del(key(sessionId));
        return null;
      }
      const session = parsed.data as StoredSession;
      if (Date.parse(session.expiresAt) <= now().getTime()) {
        await redis.del(key(sessionId));
        return null;
      }
      return session;
    },

    async save(session) {
      const at = now();
      const updated: StoredSession = { ...session, lastActivityAt: at.toISOString() };
      const ttl = remainingTtl(updated, at);
      if (ttl <= 0) {
        await redis.del(key(updated.id));
        return updated;
      }
      await redis.set(key(updated.id), JSON.stringify(updated), "EX", ttl);
      return updated;
    },

    async destroy(sessionId) {
      await redis.del(key(sessionId));
    },
  };
}

/** Validated on read so a shape change across a deploy cannot be misread. */
export const storedSessionSchema = kkdSessionSchema.extend({
  disclosureAcknowledgedAt: z.string().optional(),
  expiresAt: z.string(),
  channelUserHash: z.string().optional(),
  pendingFieldId: z.string().optional(),
  answeredFieldIds: z.array(z.string()).default([]),
  answers: z.record(z.string(), z.string()).default({}),
  pathwayId: z.string().optional(),
});
