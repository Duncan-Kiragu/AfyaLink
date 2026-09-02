import {
  type EphemeralLocation,
  type LocationPrecision,
  ephemeralLocationSchema,
} from "@kkd/contracts";

/**
 * TTL-bound, in-memory store for clinic-mode coordinates.
 *
 * Spec 9.3 / 9.5.A.5: precise coordinates in anonymous mode stay ephemeral and
 * are cleared when the session closes. Nothing here is ever written to Supabase.
 *
 * This is deliberately a process-local Map rather than Redis: the shared Redis
 * session layer is Evans' workstream 1 and is still a stub
 * (apps/api/src/modules/sessions/sessions.routes.ts). The interface mirrors what
 * a Redis-backed implementation needs - `set` takes a TTL, `get` enforces
 * expiry, `clear` deletes - so swapping in `kkd:session:{id}:location` with a
 * real EX is a drop-in change with no caller edits.
 */
export const DEFAULT_LOCATION_TTL_SECONDS = 900; // 15 minutes

export class EphemeralLocationStore {
  private entries = new Map<string, EphemeralLocation>();

  set(
    sessionId: string,
    coords: {
      latitude: number;
      longitude: number;
      accuracy?: number;
      precision: LocationPrecision;
      method: "browser" | "manual";
    },
    ttlSeconds: number = DEFAULT_LOCATION_TTL_SECONDS
  ): EphemeralLocation {
    const now = new Date();
    const entry = ephemeralLocationSchema.parse({
      sessionId,
      ...coords,
      storedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    });

    this.entries.set(sessionId, entry);
    return entry;
  }

  /** Returns null once the TTL has elapsed, deleting the expired entry. */
  get(sessionId: string): EphemeralLocation | null {
    const entry = this.entries.get(sessionId);
    if (!entry) {
      return null;
    }

    if (Date.parse(entry.expiresAt) <= Date.now()) {
      this.entries.delete(sessionId);
      return null;
    }

    return entry;
  }

  /** Called on session close. Never logs the payload being purged. */
  clear(sessionId: string): boolean {
    return this.entries.delete(sessionId);
  }

  /** Sweeps entries whose TTL elapsed without an intervening read. */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;

    for (const [sessionId, entry] of this.entries) {
      if (Date.parse(entry.expiresAt) <= now) {
        this.entries.delete(sessionId);
        purged += 1;
      }
    }

    return purged;
  }

  get size(): number {
    return this.entries.size;
  }
}

export const ephemeralLocationStore = new EphemeralLocationStore();
