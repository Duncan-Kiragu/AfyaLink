import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { channelRedisKeys, type NormalizedInboundMessage } from "@kkd/contracts";
import {
  CHANNEL_SIGNATURE_HEADER,
  CHANNEL_TIMESTAMP_HEADER,
  createChannelIdentityHasher,
  signChannelPayload,
} from "@kkd/integrations/channel";
import {
  assessment,
  createChannelHarness,
  TEST_SALT,
  TEST_WHATSAPP_SECRET,
  type ChannelHarness,
} from "../../test/channel-harness.js";

const INBOUND = "/api/v1/integrations/whatsapp/inbound";
const hasher = createChannelIdentityHasher(TEST_SALT);
const USER = hasher.hashIdentity("whatsapp", "254712345678@s.whatsapp.net");

let harness: ChannelHarness;

function inbound(overrides: Partial<NormalizedInboundMessage> = {}): NormalizedInboundMessage {
  return {
    channel: "whatsapp",
    provider: "baileys",
    channelUserHash: USER,
    providerMessageId: `MSG-${Math.random().toString(36).slice(2)}`,
    text: "hi",
    ...overrides,
  };
}

async function post(
  message: NormalizedInboundMessage,
  options: { secret?: string; timestamp?: string; signature?: string } = {},
) {
  const raw = JSON.stringify({ message });
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature =
    options.signature ??
    signChannelPayload(options.secret ?? TEST_WHATSAPP_SECRET, timestamp, raw);

  return request(harness.app)
    .post(INBOUND)
    .set("content-type", "application/json")
    .set(CHANNEL_TIMESTAMP_HEADER, timestamp)
    .set(CHANNEL_SIGNATURE_HEADER, signature)
    .send(raw);
}

/** Drives a fresh identity through disclosure so clinical turns can be tested. */
async function completeDisclosure(userHash = USER): Promise<void> {
  await post(inbound({ channelUserHash: userHash, text: "hi" }));
  await post(inbound({ channelUserHash: userHash, text: "1" }));
}

beforeEach(() => {
  harness = createChannelHarness();
});

afterEach(() => {
  harness.dispose();
});

describe("WhatsApp inbound signature verification", () => {
  it("rejects an unsigned request", async () => {
    const response = await request(harness.app)
      .post(INBOUND)
      .send({ message: inbound() });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "invalid_signature" });
  });

  it("rejects a signature made with the wrong secret", async () => {
    const response = await post(inbound(), { secret: "z".repeat(48) });
    expect(response.status).toBe(401);
  });

  it("rejects a spoofed body that reuses a valid signature", async () => {
    const genuine = inbound({ text: "chest pain" });
    const raw = JSON.stringify({ message: genuine });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signChannelPayload(TEST_WHATSAPP_SECRET, timestamp, raw);

    const response = await request(harness.app)
      .post(INBOUND)
      .set("content-type", "application/json")
      .set(CHANNEL_TIMESTAMP_HEADER, timestamp)
      .set(CHANNEL_SIGNATURE_HEADER, signature)
      .send(JSON.stringify({ message: { ...genuine, text: "tampered" } }));

    expect(response.status).toBe(401);
  });

  it("rejects a replayed request outside the timestamp window", async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 3_600);
    const response = await post(inbound(), { timestamp: stale });
    expect(response.status).toBe(401);
  });

  it("accepts a correctly signed request", async () => {
    const response = await post(inbound());
    expect(response.status).toBe(200);
  });
});

describe("WhatsApp disclosure gate", () => {
  it("answers a first contact with the AI disclosure and nothing clinical", async () => {
    const response = await post(inbound({ text: "I think I have malaria" }));
    const [message] = response.body.messages;

    expect(response.status).toBe(200);
    expect(message.text).toMatch(/does not diagnose/i);
    expect(message.text).toMatch(/temporary/i);
    // No question is asked before the disclosure is acknowledged.
    expect(response.body.messages).toHaveLength(1);
  });

  it("does not accept a clinical message until the disclosure is acknowledged", async () => {
    await post(inbound({ text: "hi" }));
    const response = await post(inbound({ text: "my chest hurts" }));
    expect(response.body.messages[0].text).toMatch(/reply 1 to confirm/i);
    expect(harness.safety.calls).toBe(0);
  });

  it("starts the interview once acknowledged", async () => {
    await post(inbound({ text: "hi" }));
    const response = await post(inbound({ text: "1" }));
    expect(response.body.messages[0].text).not.toMatch(/reply 1 to confirm/i);
    expect(harness.safety.calls).toBeGreaterThan(0);
  });

  it("accepts a Kiswahili acknowledgement", async () => {
    await post(inbound({ text: "habari" }));
    const response = await post(inbound({ text: "ndiyo" }));
    expect(response.body.messages[0].text).not.toMatch(/reply 1 to confirm/i);
  });

  it("tells the user and re-discloses when the hard session lifetime has passed", async () => {
    await completeDisclosure();
    // The record is still in Redis but past its lifetime cap, which is the
    // observable expiry case.
    const key = channelRedisKeys.identity("whatsapp", USER);
    const stored = JSON.parse(harness.redis.peek(key) as string);
    await harness.redis.set(
      key,
      JSON.stringify({ ...stored, expiresAt: "2020-01-01T00:00:00.000Z" }),
      "EX",
      600,
    );

    const response = await post(inbound({ text: "it still hurts" }));
    const joined = response.body.messages.map((m: { text: string }) => m.text).join("\n");
    expect(joined).toMatch(/expired/i);
    expect(joined).toMatch(/does not diagnose/i);
  });

  it("re-discloses after Redis has dropped the session entirely", async () => {
    await completeDisclosure();
    harness.redis.expireNow(channelRedisKeys.identity("whatsapp", USER));

    const response = await post(inbound({ text: "it still hurts" }));
    const joined = response.body.messages.map((m: { text: string }) => m.text).join("\n");
    // We deliberately cannot say "your session expired" here: knowing that
    // would require retaining a marker per pseudonym past the session.
    expect(joined).toMatch(/does not diagnose/i);
    expect(harness.safety.calls).toBe(1);
  });

  it("re-discloses when the disclosure version is superseded", async () => {
    await completeDisclosure();
    const key = channelRedisKeys.identity("whatsapp", USER);
    const stored = JSON.parse(harness.redis.peek(key) as string);
    await harness.redis.set(
      key,
      JSON.stringify({ ...stored, disclosureVersion: "0.9.0" }),
      "EX",
      600,
    );

    const response = await post(inbound({ text: "it still hurts" }));
    const joined = response.body.messages.map((m: { text: string }) => m.text).join("\n");
    expect(joined).toMatch(/does not diagnose/i);
  });
});

describe("WhatsApp idempotency", () => {
  it("replays the same reply for a duplicate webhook delivery", async () => {
    const message = inbound({ text: "hi" });
    const first = await post(message);
    const second = await post(message);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.messages).toEqual(first.body.messages);
  });

  it("does not double-advance the session on a duplicate delivery", async () => {
    await completeDisclosure();
    const before = harness.safety.calls;

    const message = inbound({ text: "since yesterday" });
    await post(message);
    const afterFirst = harness.safety.calls;
    await post(message);

    expect(afterFirst).toBeGreaterThan(before);
    // The replay is served from cache, so the engine is not re-run.
    expect(harness.safety.calls).toBe(afterFirst);
  });

  it("treats distinct provider message ids as distinct turns", async () => {
    await completeDisclosure();
    const first = await post(inbound({ text: "started this morning" }));
    const second = await post(inbound({ text: "it is a 7 out of 10" }));
    expect(second.body.replayed).toBeUndefined();
    expect(second.body.messages).toBeDefined();
    expect(first.status).toBe(200);
  });
});

describe("WhatsApp media policy", () => {
  it("refuses media with an approved message and never runs the engine", async () => {
    await completeDisclosure();
    const before = harness.safety.calls;

    const response = await post(inbound({ text: undefined, rejection: "unsupported_media" }));
    expect(response.body.messages[0].text).toMatch(/cannot review images/i);
    expect(response.body.messages[0].text).toMatch(/nothing was opened or forwarded/i);
    expect(harness.safety.calls).toBe(before);
  });

  it("refuses an over-long message", async () => {
    await completeDisclosure();
    const response = await post(inbound({ text: undefined, rejection: "too_long" }));
    expect(response.body.messages[0].text).toMatch(/too long/i);
  });
});

describe("WhatsApp emergency handling", () => {
  it("returns the emergency message synchronously in the same response", async () => {
    harness.safety.next = assessment({ urgency: "emergency" });
    await post(inbound({ text: "hi" }));
    const response = await post(inbound({ text: "1" }));

    const urgent = response.body.messages.find((m: { urgent: boolean }) => m.urgent);
    expect(urgent).toBeDefined();
    expect(urgent.text).toMatch(/emergency assessment now/i);
    expect(urgent.terminal).toBe(true);
  });

  it("uses the reviewed string, not model wording, for the emergency notice", async () => {
    harness.safety.next = assessment({ urgency: "emergency" });
    harness.ai.plannedQuestion = "This sounds like appendicitis.";
    await post(inbound({ text: "hi" }));
    const response = await post(inbound({ text: "1" }));

    const joined = response.body.messages.map((m: { text: string }) => m.text).join("\n");
    expect(joined).not.toMatch(/appendicitis/i);
  });
});

describe("WhatsApp stale-state recovery", () => {
  it("re-discloses instead of erroring when the engine session outlived its mapping", async () => {
    await completeDisclosure();
    // The channel mapping and the engine session have independent TTLs, so the
    // engine session can disappear while the mapping survives.
    const key = channelRedisKeys.identity("whatsapp", USER);
    const stored = JSON.parse(harness.redis.peek(key) as string);
    await harness.redis.del(`kkd:session:${stored.sessionId}`);

    const response = await post(inbound({ text: "the pain is worse" }));
    expect(response.status).toBe(200);
    const joined = response.body.messages.map((m: { text: string }) => m.text).join("\n");
    expect(joined).toMatch(/does not diagnose/i);
  });

  it("starts a clean disclosed session after an emergency ended the last one", async () => {
    harness.safety.next = assessment({ urgency: "emergency" });
    await post(inbound({ text: "hi" }));
    await post(inbound({ text: "1" }));

    // The red flag closed the interview; the mapping must be gone too.
    expect(
      harness.redis.keys().filter((k) => k.includes(":identity:")),
    ).toEqual([]);

    harness.safety.next = assessment({ urgency: "monitor" });
    const next = await post(inbound({ text: "hello again" }));
    const joined = next.body.messages.map((m: { text: string }) => m.text).join("\n");
    expect(next.status).toBe(200);
    expect(joined).toMatch(/does not diagnose/i);
  });
});

describe("WhatsApp language switching", () => {
  it("switches language without losing the session", async () => {
    await completeDisclosure();
    const before = harness.redis.peek(channelRedisKeys.identity("whatsapp", USER));
    const sessionId = before ? JSON.parse(before).sessionId : undefined;

    await post(inbound({ text: "lang" }));
    const switched = await post(inbound({ text: "kiswahili" }));

    const after = harness.redis.peek(channelRedisKeys.identity("whatsapp", USER));
    expect(after ? JSON.parse(after).sessionId : undefined).toBe(sessionId);
    expect(after ? JSON.parse(after).locale : undefined).toBe("sw");
    expect(switched.body.messages[0].text).toMatch(/Kiswahili/);
  });

  it("offers language choices as a numbered menu", async () => {
    await completeDisclosure();
    const response = await post(inbound({ text: "lang" }));
    expect(response.body.messages[0].choices.map((c: { id: string }) => c.id)).toEqual([
      "en",
      "sw",
    ]);
  });
});

describe("WhatsApp session close", () => {
  it("deletes channel and session state on an explicit close", async () => {
    await completeDisclosure();
    expect(harness.redis.keys().length).toBeGreaterThan(0);

    const response = await post(inbound({ text: "close" }));
    expect(response.body.messages[0].text).toMatch(/deleted/i);
    expect(response.body.messages[0].text).toMatch(/nothing was saved/i);

    const remaining = harness.redis
      .keys()
      .filter((key) => key.startsWith("kkd:session:") || key.includes(":identity:"));
    expect(remaining).toEqual([]);
  });
});

describe("WhatsApp degraded service", () => {
  it("keeps interviewing from the reviewed pathway when Claude is down", async () => {
    harness.ai.failPlan = true;
    harness.ai.failExtract = true;
    await post(inbound({ text: "hi" }));
    const response = await post(inbound({ text: "1" }));

    const joined = response.body.messages.map((m: { text: string }) => m.text).join("\n");
    expect(joined).toMatch(/temporarily unavailable/i);
    expect(joined).toMatch(/main problem/i);
    expect(harness.safety.calls).toBeGreaterThan(0);
  });

  it("never claims reassurance when the safety engine fails", async () => {
    harness.safety.fail = true;
    await post(inbound({ text: "hi" }));
    const response = await post(inbound({ text: "1" }));

    const joined = response.body.messages.map((m: { text: string }) => m.text).join("\n");
    expect(joined).toMatch(/could not be completed/i);
    expect(joined).not.toMatch(/no urgent warning sign/i);
  });
});

describe("WhatsApp feature flag", () => {
  it("reports the channel as disabled when the flag is off", async () => {
    harness.dispose();
    harness = createChannelHarness({ whatsapp: false });
    const response = await post(inbound());
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("channel_disabled");
  });
});

describe("WhatsApp persistence boundary", () => {
  it("never creates a health record from channel participation", async () => {
    await completeDisclosure();
    await post(inbound({ text: "abdominal pain" }));
    // Nothing outside the ephemeral namespaces may be written.
    const unexpected = harness.redis
      .keys()
      .filter((key) => !key.startsWith("kkd:session:") && !key.startsWith("kkd:channel:"));
    expect(unexpected).toEqual([]);
  });
});
