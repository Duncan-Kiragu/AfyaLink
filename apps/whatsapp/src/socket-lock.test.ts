import { beforeEach, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { channelRedisKeys } from "@kkd/contracts";
import { asRedis, FakeRedis } from "@kkd/testing";
import { SocketLock } from "./socket-lock.js";

let redis: FakeRedis;

beforeEach(() => {
  redis = new FakeRedis();
});

function lock(ownerId: string, onLost?: () => void): SocketLock {
  return new SocketLock({
    redis: asRedis<Redis>(redis),
    ownerId,
    ttlSeconds: 30,
    ...(onLost ? { onLost } : {}),
  });
}

describe("SocketLock", () => {
  it("grants the lock to the first process", async () => {
    const first = lock("proc-a");
    expect(await first.acquire()).toBe(true);
    expect(first.isHeld()).toBe(true);
    await first.release();
  });

  it("refuses a second process, so only one socket is ever opened", async () => {
    // Two Baileys sockets on one credential set log each other out, so this is
    // the invariant that keeps the WhatsApp session alive.
    const first = lock("proc-a");
    const second = lock("proc-b");
    await first.acquire();

    expect(await second.acquire()).toBe(false);
    expect(second.isHeld()).toBe(false);
    await first.release();
  });

  it("lets the same owner re-take its lock after a restart", async () => {
    const first = lock("proc-a");
    await first.acquire();
    // Simulates the process dying without releasing.
    const again = lock("proc-a");
    expect(await again.acquire()).toBe(true);
    await again.release();
  });

  it("frees the lock for a standby once released", async () => {
    const first = lock("proc-a");
    await first.acquire();
    await first.release();
    expect(redis.peek(channelRedisKeys.whatsappSocketLock())).toBeUndefined();

    const second = lock("proc-b");
    expect(await second.acquire()).toBe(true);
    await second.release();
  });

  it("frees the lock for a standby once the TTL lapses", async () => {
    const first = lock("proc-a");
    await first.acquire();
    redis.expireNow(channelRedisKeys.whatsappSocketLock());

    const second = lock("proc-b");
    expect(await second.acquire()).toBe(true);
    await second.release();
  });

  it("does not release a lock another process now owns", async () => {
    const first = lock("proc-a");
    await first.acquire();
    // Another process took over after the TTL lapsed.
    await redis.set(channelRedisKeys.whatsappSocketLock(), "proc-b", "EX", 30);

    await first.release();
    expect(redis.peek(channelRedisKeys.whatsappSocketLock())).toBe("proc-b");
  });
});
