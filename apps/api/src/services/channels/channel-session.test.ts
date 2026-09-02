import { beforeEach, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { channelRedisKeys } from "@kkd/contracts";
import { asRedis, FakeRedis } from "@kkd/testing";
import {
  createChannelSessionStore,
  isExpired,
  newChannelSession,
  type ChannelSessionStore,
} from "./channel-session.js";

let redis: FakeRedis;
let store: ChannelSessionStore;

const NOW = new Date("2026-09-02T10:00:00.000Z");

beforeEach(() => {
  redis = new FakeRedis();
  store = createChannelSessionStore(asRedis<Redis>(redis), {
    ttlSeconds: 1800,
    maxLifetimeSeconds: 14400,
    ussdTtlSeconds: 180,
    now: () => NOW,
  });
});

function session(overrides: Partial<ReturnType<typeof newChannelSession>> = {}) {
  return {
    ...newChannelSession({
      channel: "whatsapp",
      channelUserHash: "hash-1",
      sessionId: "session-1",
      locale: "en",
      disclosureVersion: "1.0.0",
      maxLifetimeSeconds: 14400,
      now: NOW,
    }),
    ...overrides,
  };
}

describe("newChannelSession", () => {
  it("sets a hard expiry from the lifetime cap", () => {
    const created = session();
    expect(created.expiresAt).toBe("2026-09-02T14:00:00.000Z");
  });
});

describe("channel session store", () => {
  it("round-trips a session", async () => {
    await store.save(session());
    const found = await store.find("whatsapp", "hash-1");
    expect(found.session?.sessionId).toBe("session-1");
    expect(found.expired).toBe(false);
  });

  it("keys by the pseudonym only", async () => {
    await store.save(session());
    expect(redis.keys()).toEqual([channelRedisKeys.identity("whatsapp", "hash-1")]);
  });

  it("reports nothing for an unknown identity", async () => {
    expect(await store.find("whatsapp", "unknown")).toEqual({ expired: false });
  });

  it("reports expiry and drops the record when the lifetime cap has passed", async () => {
    await store.save(session({ expiresAt: "2026-09-02T09:00:00.000Z" }));
    // Written directly, because `save` refuses to store an already-dead record.
    await redis.set(
      channelRedisKeys.identity("whatsapp", "hash-1"),
      JSON.stringify(session({ expiresAt: "2026-09-02T09:00:00.000Z" })),
      "EX",
      600,
    );

    expect(await store.find("whatsapp", "hash-1")).toEqual({ expired: true });
    expect(redis.keys()).toEqual([]);
  });

  it("refuses to store a session already past its lifetime cap", async () => {
    await store.save(session({ expiresAt: "2026-09-02T09:00:00.000Z" }));
    expect(redis.keys()).toEqual([]);
  });

  it("caps the sliding TTL at the remaining hard lifetime", async () => {
    // 10 minutes of lifetime left, so the TTL must not be the full 1800s.
    await store.save(session({ expiresAt: "2026-09-02T10:10:00.000Z" }));
    const ttl = await redis.ttl(channelRedisKeys.identity("whatsapp", "hash-1"));
    expect(ttl).toBeLessThanOrEqual(600);
    expect(ttl).toBeGreaterThan(0);
  });

  it("discards a record whose shape no longer validates", async () => {
    await redis.set(
      channelRedisKeys.identity("whatsapp", "hash-1"),
      JSON.stringify({ channel: "whatsapp" }),
      "EX",
      600,
    );
    expect(await store.find("whatsapp", "hash-1")).toEqual({ expired: false });
    expect(redis.keys()).toEqual([]);
  });

  it("discards unparseable JSON", async () => {
    await redis.set(channelRedisKeys.identity("whatsapp", "hash-1"), "{not json", "EX", 600);
    expect(await store.find("whatsapp", "hash-1")).toEqual({ expired: false });
  });

  it("advances last activity on touch without extending the hard expiry", async () => {
    const original = session();
    await store.save(original);
    const touched = await store.touch(original);
    expect(touched.lastActivityAt).toBe(NOW.toISOString());
    expect(touched.expiresAt).toBe(original.expiresAt);
  });

  it("removes a session on demand", async () => {
    await store.save(session());
    await store.remove("whatsapp", "hash-1");
    expect(redis.keys()).toEqual([]);
  });
});

describe("USSD dialogue state", () => {
  const ussdState = {
    providerSessionIdHash: "psid",
    channelUserHash: "hash-1",
    sessionId: "session-1",
    currentStep: "disclosure" as const,
    locale: "en",
    disclosureVersion: "1.0.0",
    disclosureAcknowledged: false,
    pendingChoices: [],
    pendingChoiceLabels: {},
    screenCount: 0,
    createdAt: NOW.toISOString(),
    expiresAt: "2026-09-02T10:03:00.000Z",
  };

  it("round-trips dialogue state under the hashed provider session id", async () => {
    await store.saveUssd(ussdState);
    expect(redis.keys()).toEqual([channelRedisKeys.ussdState("psid")]);
    expect((await store.findUssd("psid"))?.sessionId).toBe("session-1");
  });

  it("returns nothing for expired dialogue state", async () => {
    await store.saveUssd({ ...ussdState, expiresAt: "2026-09-02T09:59:00.000Z" });
    expect(await store.findUssd("psid")).toBeNull();
  });

  it("removes dialogue state on demand", async () => {
    await store.saveUssd(ussdState);
    await store.removeUssd("psid");
    expect(redis.keys()).toEqual([]);
  });
});

describe("isExpired", () => {
  it("treats an unparseable timestamp as expired", () => {
    // Failing closed is the safe direction for a clinical session record.
    expect(isExpired({ expiresAt: "not-a-date" }, NOW)).toBe(true);
  });

  it("compares against the supplied clock", () => {
    expect(isExpired({ expiresAt: "2026-09-02T10:00:01.000Z" }, NOW)).toBe(false);
    expect(isExpired({ expiresAt: "2026-09-02T09:59:59.000Z" }, NOW)).toBe(true);
  });
});
