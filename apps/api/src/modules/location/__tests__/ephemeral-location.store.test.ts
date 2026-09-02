import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { EphemeralLocationStore } from "../ephemeral-location.store.js";

const COORDS = {
  latitude: -1.2921,
  longitude: 36.8219,
  precision: "reduced" as const,
  method: "browser" as const,
};

describe("EphemeralLocationStore", () => {
  let store: EphemeralLocationStore;

  beforeEach(() => {
    store = new EphemeralLocationStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should store and read back a location", () => {
    store.set("s1", COORDS);
    expect(store.get("s1")).toMatchObject({
      sessionId: "s1",
      latitude: -1.2921,
      precision: "reduced",
    });
  });

  it("should stamp an expiry from the TTL", () => {
    const entry = store.set("s1", COORDS, 60);
    const ttlMs = Date.parse(entry.expiresAt) - Date.parse(entry.storedAt);
    expect(ttlMs).toBe(60_000);
  });

  it("should return null for an unknown session", () => {
    expect(store.get("nope")).toBeNull();
  });

  it("should clear a session and leave nothing behind", () => {
    store.set("s1", COORDS);
    expect(store.clear("s1")).toBe(true);
    expect(store.get("s1")).toBeNull();
    expect(store.size).toBe(0);
  });

  it("should expire entries once the TTL elapses", () => {
    vi.useFakeTimers();
    store.set("s1", COORDS, 10);

    vi.advanceTimersByTime(11_000);

    expect(store.get("s1")).toBeNull();
    expect(store.size).toBe(0);
  });

  it("should purge expired entries that were never read", () => {
    vi.useFakeTimers();
    store.set("stale", COORDS, 10);
    store.set("fresh", COORDS, 3600);

    vi.advanceTimersByTime(11_000);

    expect(store.purgeExpired()).toBe(1);
    expect(store.size).toBe(1);
    expect(store.get("fresh")).not.toBeNull();
  });

  it("should reject coordinates outside valid ranges", () => {
    expect(() => store.set("s1", { ...COORDS, latitude: 91 })).toThrow();
  });
});
