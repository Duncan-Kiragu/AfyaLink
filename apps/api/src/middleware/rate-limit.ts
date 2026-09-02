import rateLimit, { MemoryStore } from "express-rate-limit";

/**
 * Held explicitly rather than left implicit so tests can clear it.
 *
 * The limiter is module-level state shared by every `createApp()` in a process, so
 * without a reset one test file's traffic counts against the next one's.
 */
const store = new MemoryStore();

export const rateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store,
});

/** Clears the rate-limit window. Test-support only; never call it from a request path. */
export async function resetRateLimit(): Promise<void> {
  await store.resetAll();
}
