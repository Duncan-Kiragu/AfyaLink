/**
 * In-memory stand-in for the subset of Redis the KKD services use.
 *
 * Written by hand rather than pulled from a mock library so that TTL semantics
 * are explicit and controllable: several channel tests turn on a session
 * expiring at an exact moment, and "the key vanished" has to be reproducible.
 */

type Entry = { value: string; expiresAtMs?: number };
type HashEntry = { fields: Map<string, string>; expiresAtMs?: number };
type ListEntry = { values: string[]; expiresAtMs?: number };

export interface FakeRedisOptions {
  /** Injectable clock so tests can jump past a TTL. */
  now?: () => number;
}

export class FakeRedis {
  private strings = new Map<string, Entry>();
  private hashes = new Map<string, HashEntry>();
  private lists = new Map<string, ListEntry>();
  private nowMs: () => number;
  /** Set to make every command reject, to exercise the outage paths. */
  failing = false;

  constructor(options: FakeRedisOptions = {}) {
    this.nowMs = options.now ?? (() => Date.now());
  }

  private guard(): void {
    if (this.failing) throw new Error("fake redis is unavailable");
  }

  private live<T extends { expiresAtMs?: number }>(
    map: Map<string, T>,
    key: string,
  ): T | undefined {
    const entry = map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs !== undefined && entry.expiresAtMs <= this.nowMs()) {
      map.delete(key);
      return undefined;
    }
    return entry;
  }

  async ping(): Promise<string> {
    this.guard();
    return "PONG";
  }

  async get(key: string): Promise<string | null> {
    this.guard();
    return this.live(this.strings, key)?.value ?? null;
  }

  async set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<"OK" | null> {
    this.guard();
    const upper = args.map((arg) => String(arg).toUpperCase());
    const exIndex = upper.indexOf("EX");
    const ttlSeconds = exIndex >= 0 ? Number(args[exIndex + 1]) : undefined;
    const nx = upper.includes("NX");

    if (nx && this.live(this.strings, key)) return null;

    this.strings.set(key, {
      value,
      ...(ttlSeconds !== undefined && Number.isFinite(ttlSeconds)
        ? { expiresAtMs: this.nowMs() + ttlSeconds * 1000 }
        : {}),
    });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    this.guard();
    let removed = 0;
    for (const key of keys) {
      if (this.strings.delete(key)) removed += 1;
      if (this.hashes.delete(key)) removed += 1;
      if (this.lists.delete(key)) removed += 1;
    }
    return removed;
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    this.guard();
    const entry = this.live(this.strings, key);
    if (!entry) return 0;
    entry.expiresAtMs = this.nowMs() + ttlSeconds * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    this.guard();
    const entry = this.live(this.strings, key);
    if (!entry) return -2;
    if (entry.expiresAtMs === undefined) return -1;
    return Math.ceil((entry.expiresAtMs - this.nowMs()) / 1000);
  }

  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    this.guard();
    const entry = this.live(this.hashes, key);
    return fields.map((field) => entry?.fields.get(field) ?? null);
  }

  async hset(key: string, entries: Record<string, string>): Promise<number> {
    this.guard();
    const existing = this.live(this.hashes, key) ?? { fields: new Map<string, string>() };
    for (const [field, value] of Object.entries(entries)) existing.fields.set(field, value);
    this.hashes.set(key, existing);
    return Object.keys(entries).length;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    this.guard();
    const entry = this.live(this.hashes, key);
    if (!entry) return 0;
    let removed = 0;
    for (const field of fields) if (entry.fields.delete(field)) removed += 1;
    return removed;
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    this.guard();
    const entry = this.live(this.lists, key) ?? { values: [] };
    entry.values.push(...values);
    this.lists.set(key, entry);
    return entry.values.length;
  }

  async lpop(key: string, count?: number): Promise<string[] | string | null> {
    this.guard();
    const entry = this.live(this.lists, key);
    if (!entry || entry.values.length === 0) return count === undefined ? null : [];
    if (count === undefined) return entry.values.shift() ?? null;
    return entry.values.splice(0, count);
  }

  async quit(): Promise<"OK"> {
    return "OK";
  }

  // --- test helpers ---------------------------------------------------------

  /** Every live key, for asserting that a close actually purged state. */
  keys(): string[] {
    const all = [
      ...this.strings.keys(),
      ...this.hashes.keys(),
      ...this.lists.keys(),
    ];
    return all.filter(
      (key) =>
        this.live(this.strings, key) ??
        this.live(this.hashes, key) ??
        this.live(this.lists, key),
    );
  }

  /** Raw stored value, bypassing the public API. */
  peek(key: string): string | undefined {
    return this.live(this.strings, key)?.value;
  }

  /** Forces an entry to look expired without waiting. */
  expireNow(key: string): void {
    const entry = this.strings.get(key);
    if (entry) entry.expiresAtMs = this.nowMs() - 1;
    const hash = this.hashes.get(key);
    if (hash) hash.expiresAtMs = this.nowMs() - 1;
  }

  flush(): void {
    this.strings.clear();
    this.hashes.clear();
    this.lists.clear();
  }
}

/** Cast helper: the fake implements only the commands KKD actually calls. */
export function asRedis<T>(fake: FakeRedis): T {
  return fake as unknown as T;
}
