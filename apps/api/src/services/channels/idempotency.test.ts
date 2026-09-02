import { beforeEach, describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { asRedis, FakeRedis } from "@kkd/testing";
import { createIdempotencyStore, type IdempotencyStore } from "./idempotency.js";

let redis: FakeRedis;
let store: IdempotencyStore;

beforeEach(() => {
  redis = new FakeRedis();
  store = createIdempotencyStore(asRedis<Redis>(redis), 300);
});

describe("createIdempotencyStore", () => {
  it("claims an unseen provider message id", async () => {
    expect(await store.claim("whatsapp", "MSG1")).toEqual({ status: "claimed" });
  });

  it("reports a second concurrent claim as in flight, not claimed", async () => {
    await store.claim("whatsapp", "MSG1");
    expect(await store.claim("whatsapp", "MSG1")).toEqual({ status: "in_flight" });
  });

  it("replays the stored response once the first claim completed", async () => {
    await store.claim("ussd", "AT_1:1:1");
    await store.complete("ussd", "AT_1:1:1", "CON 1. English");
    expect(await store.claim("ussd", "AT_1:1:1")).toEqual({
      status: "replay",
      response: "CON 1. English",
    });
  });

  it("keeps channels in separate namespaces", async () => {
    await store.claim("whatsapp", "SAME");
    expect(await store.claim("ussd", "SAME")).toEqual({ status: "claimed" });
  });

  it("allows a retry after the claim is released", async () => {
    await store.claim("whatsapp", "MSG1");
    // Releasing on failure is what lets a provider's retry be processed rather
    // than silently treated as already handled.
    await store.release("whatsapp", "MSG1");
    expect(await store.claim("whatsapp", "MSG1")).toEqual({ status: "claimed" });
  });

  it("re-claims after the record expires", async () => {
    await store.claim("whatsapp", "MSG1");
    await store.complete("whatsapp", "MSG1", "reply");
    redis.expireNow("kkd:channel:whatsapp:idem:MSG1");
    expect(await store.claim("whatsapp", "MSG1")).toEqual({ status: "claimed" });
  });

  it("replays an empty completion body rather than reprocessing", async () => {
    await store.claim("ussd", "K");
    await store.complete("ussd", "K", "END done");
    const outcome = await store.claim("ussd", "K");
    expect(outcome.status).toBe("replay");
  });
});
