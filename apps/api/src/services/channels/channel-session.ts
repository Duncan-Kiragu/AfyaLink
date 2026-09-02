import type { Redis } from "ioredis";
import {
  channelRedisKeys,
  channelSessionSchema,
  ussdSessionStateSchema,
  type Channel,
  type ChannelSession,
  type UssdSessionState,
} from "@kkd/contracts";

/**
 * Redis-held channel interaction state.
 *
 * Two invariants the spec pins down:
 *  - the key is a pseudonym, never the phone number or provider session id
 *    (spec §11.3B, §11.4A);
 *  - every record carries both a sliding TTL and a hard `expiresAt`, so a
 *    chatty user cannot keep an ephemeral clinical session alive forever
 *    (spec §4.3E).
 */

/**
 * Result of a lookup.
 *
 * `expired: true` is only reachable when the record is still in Redis but past
 * its hard `expiresAt` — the sliding TTL is shorter than the lifetime cap, so
 * this is the common case. Once Redis drops the key we deliberately cannot
 * tell a returning user from a first contact: knowing that would mean keeping a
 * per-pseudonym marker alive beyond the session, which is exactly the retention
 * the anonymous channel path is meant to avoid (spec §11.7, §16.1).
 */
export interface ChannelSessionLookup {
  session?: ChannelSession;
  expired: boolean;
}

export interface ChannelSessionStore {
  find(channel: Channel, channelUserHash: string): Promise<ChannelSessionLookup>;
  save(session: ChannelSession): Promise<void>;
  touch(session: ChannelSession): Promise<ChannelSession>;
  remove(channel: Channel, channelUserHash: string): Promise<void>;
  findUssd(providerSessionIdHash: string): Promise<UssdSessionState | null>;
  saveUssd(state: UssdSessionState): Promise<void>;
  removeUssd(providerSessionIdHash: string): Promise<void>;
}

export interface ChannelSessionStoreOptions {
  /** Sliding idle TTL. */
  ttlSeconds: number;
  /** Absolute cap from creation, regardless of activity. */
  maxLifetimeSeconds: number;
  ussdTtlSeconds: number;
  now?: () => Date;
}

export function isExpired(session: { expiresAt: string }, now: Date): boolean {
  const expires = Date.parse(session.expiresAt);
  return !Number.isFinite(expires) || expires <= now.getTime();
}

export function createChannelSessionStore(
  redis: Redis,
  options: ChannelSessionStoreOptions,
): ChannelSessionStore {
  const now = options.now ?? (() => new Date());

  /** Remaining seconds before the hard lifetime cap, floored at zero. */
  const remainingTtl = (session: ChannelSession, at: Date): number => {
    const hardStop = Date.parse(session.expiresAt) - at.getTime();
    return Math.max(0, Math.min(options.ttlSeconds, Math.ceil(hardStop / 1000)));
  };

  return {
    async find(channel, channelUserHash) {
      const raw = await redis.get(channelRedisKeys.identity(channel, channelUserHash));
      if (!raw) return { expired: false };
      const parsed = channelSessionSchema.safeParse(safeJsonParse(raw));
      if (!parsed.success) {
        // Shape drifted across a deploy; drop it and start a clean session
        // rather than driving a clinical conversation from unknown state.
        await redis.del(channelRedisKeys.identity(channel, channelUserHash));
        return { expired: false };
      }
      if (isExpired(parsed.data, now())) {
        await redis.del(channelRedisKeys.identity(channel, channelUserHash));
        return { expired: true };
      }
      return { session: parsed.data, expired: false };
    },

    async save(session) {
      const at = now();
      const ttl = remainingTtl(session, at);
      if (ttl <= 0) {
        await redis.del(channelRedisKeys.identity(session.channel, session.channelUserHash));
        return;
      }
      await redis.set(
        channelRedisKeys.identity(session.channel, session.channelUserHash),
        JSON.stringify(session),
        "EX",
        ttl,
      );
    },

    async touch(session) {
      const at = now();
      const updated: ChannelSession = { ...session, lastActivityAt: at.toISOString() };
      const ttl = remainingTtl(updated, at);
      if (ttl <= 0) {
        await redis.del(channelRedisKeys.identity(session.channel, session.channelUserHash));
        return updated;
      }
      await redis.set(
        channelRedisKeys.identity(updated.channel, updated.channelUserHash),
        JSON.stringify(updated),
        "EX",
        ttl,
      );
      return updated;
    },

    async remove(channel, channelUserHash) {
      await redis.del(channelRedisKeys.identity(channel, channelUserHash));
    },

    async findUssd(providerSessionIdHash) {
      const raw = await redis.get(channelRedisKeys.ussdState(providerSessionIdHash));
      if (!raw) return null;
      const parsed = ussdSessionStateSchema.safeParse(safeJsonParse(raw));
      if (!parsed.success) {
        await redis.del(channelRedisKeys.ussdState(providerSessionIdHash));
        return null;
      }
      return isExpired(parsed.data, now()) ? null : parsed.data;
    },

    async saveUssd(state) {
      await redis.set(
        channelRedisKeys.ussdState(state.providerSessionIdHash),
        JSON.stringify(state),
        "EX",
        options.ussdTtlSeconds,
      );
    },

    async removeUssd(providerSessionIdHash) {
      await redis.del(channelRedisKeys.ussdState(providerSessionIdHash));
    },
  };
}

export function newChannelSession(input: {
  channel: Channel;
  channelUserHash: string;
  sessionId: string;
  locale: string;
  disclosureVersion: string;
  maxLifetimeSeconds: number;
  now?: Date;
}): ChannelSession {
  const at = input.now ?? new Date();
  return {
    channel: input.channel,
    channelUserHash: input.channelUserHash,
    sessionId: input.sessionId,
    locale: input.locale,
    disclosureVersion: input.disclosureVersion,
    createdAt: at.toISOString(),
    lastActivityAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + input.maxLifetimeSeconds * 1000).toISOString(),
  };
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
