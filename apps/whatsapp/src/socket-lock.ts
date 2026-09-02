import type { Redis } from "ioredis";
import { channelRedisKeys } from "@kkd/contracts";

/**
 * Single-writer lock for the WhatsApp socket.
 *
 * WhatsApp allows one linked-device session per credential set. Two gateway
 * instances holding the same credentials fight over the Signal ratchet and end
 * up logging each other out, so exactly one process may connect. The lock is a
 * short-TTL Redis key that the holder renews; if the holder dies, the key
 * expires and a standby takes over on its next attempt.
 */

const RENEW_RATIO = 0.5;

export interface SocketLockOptions {
  redis: Redis;
  /** Unique per process; used to prove ownership before releasing. */
  ownerId: string;
  ttlSeconds?: number;
  onLost?: () => void;
}

export class SocketLock {
  private timer: NodeJS.Timeout | undefined;
  private held = false;

  constructor(private readonly options: SocketLockOptions) {}

  private get key(): string {
    return channelRedisKeys.whatsappSocketLock();
  }

  private get ttl(): number {
    return this.options.ttlSeconds ?? 30;
  }

  isHeld(): boolean {
    return this.held;
  }

  async acquire(): Promise<boolean> {
    const acquired = await this.options.redis.set(
      this.key,
      this.options.ownerId,
      "EX",
      this.ttl,
      "NX",
    );
    if (acquired !== "OK") {
      // Re-acquire our own lock after a restart with the same owner id.
      const current = await this.options.redis.get(this.key);
      if (current !== this.options.ownerId) return false;
      await this.options.redis.expire(this.key, this.ttl);
    }
    this.held = true;
    this.startRenewal();
    return true;
  }

  private startRenewal(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(
      () => {
        void this.renew();
      },
      Math.max(1_000, this.ttl * RENEW_RATIO * 1000),
    );
    this.timer.unref?.();
  }

  private async renew(): Promise<void> {
    try {
      const current = await this.options.redis.get(this.key);
      if (current !== this.options.ownerId) {
        // Someone else owns it now. Stop pretending to be the writer.
        this.held = false;
        if (this.timer) clearInterval(this.timer);
        this.options.onLost?.();
        return;
      }
      await this.options.redis.expire(this.key, this.ttl);
    } catch {
      // A transient Redis error is not proof of lock loss; the next renewal
      // either succeeds or the key expires and another process takes over.
    }
  }

  async release(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.held = false;
    try {
      const current = await this.options.redis.get(this.key);
      if (current === this.options.ownerId) await this.options.redis.del(this.key);
    } catch {
      // Let the TTL clean it up.
    }
  }
}
