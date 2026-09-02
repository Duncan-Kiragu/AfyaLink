import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { USSD_MAX_SCREEN_CHARS, channelRedisKeys } from "@kkd/contracts";
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
  TEST_USSD_SECRET,
  type ChannelHarness,
} from "../../test/channel-harness.js";

const CALLBACK = "/api/v1/integrations/ussd";
const PHONE = "+254712345678";
const hasher = createChannelIdentityHasher(TEST_SALT);

let harness: ChannelHarness;
let sessionCounter = 0;

function newSessionId(): string {
  sessionCounter += 1;
  return `AT_${sessionCounter}`;
}

/** Africa's Talking posts form-encoded bodies, so tests do the same. */
function encode(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

async function callback(
  fields: { sessionId: string; phoneNumber?: string; text?: string; serviceCode?: string },
  options: { secret?: string; timestamp?: string } = {},
) {
  const raw = encode({
    sessionId: fields.sessionId,
    phoneNumber: fields.phoneNumber ?? PHONE,
    text: fields.text ?? "",
    serviceCode: fields.serviceCode ?? "*384*1#",
  });
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = signChannelPayload(options.secret ?? TEST_USSD_SECRET, timestamp, raw);

  return request(harness.app)
    .post(CALLBACK)
    .set("content-type", "application/x-www-form-urlencoded")
    .set(CHANNEL_TIMESTAMP_HEADER, timestamp)
    .set(CHANNEL_SIGNATURE_HEADER, signature)
    .send(raw);
}

beforeEach(() => {
  harness = createChannelHarness();
});

afterEach(() => {
  harness.dispose();
});

describe("USSD callback authentication", () => {
  it("rejects an unsigned callback", async () => {
    const response = await request(harness.app)
      .post(CALLBACK)
      .set("content-type", "application/x-www-form-urlencoded")
      .send(encode({ sessionId: "AT_x", phoneNumber: PHONE, text: "" }));
    expect(response.status).toBe(401);
  });

  it("rejects a callback signed with the wrong secret", async () => {
    const response = await callback({ sessionId: newSessionId() }, { secret: "q".repeat(48) });
    expect(response.status).toBe(401);
  });

  it("rejects a stale (replayed) callback", async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 3_600);
    const response = await callback({ sessionId: newSessionId() }, { timestamp: stale });
    expect(response.status).toBe(401);
  });
});

describe("USSD first screen", () => {
  it("serves the compressed AI disclosure before any clinical question", async () => {
    const response = await callback({ sessionId: newSessionId() });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/plain/);
    expect(response.text.startsWith("CON ")).toBe(true);
    expect(response.text).toMatch(/NOT diagnose/i);
    expect(response.text).toMatch(/temporary/i);
    expect(harness.safety.calls).toBe(0);
  });

  it("stays inside the provider screen budget", async () => {
    const response = await callback({ sessionId: newSessionId() });
    expect(response.text.length).toBeLessThanOrEqual(USSD_MAX_SCREEN_CHARS);
  });

  it("stores state under a hashed provider session id, not the raw one", async () => {
    const sessionId = newSessionId();
    await callback({ sessionId });

    const keys = harness.redis.keys().filter((key) => key.includes("channel:ussd:state"));
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(sessionId);
    expect(keys[0]).toContain(hasher.hashProviderSessionId(sessionId));
  });

  it("never writes the caller's phone number anywhere in Redis", async () => {
    const sessionId = newSessionId();
    await callback({ sessionId });
    await callback({ sessionId, text: "1" });

    const dump = harness.redis
      .keys()
      .map((key) => `${key}=${harness.redis.peek(key) ?? ""}`)
      .join("\n");
    expect(dump).not.toContain("254712345678");
    expect(dump).not.toContain("712345678");
  });
});

describe("USSD language and disclosure", () => {
  it("advances to the first question in English", async () => {
    const sessionId = newSessionId();
    await callback({ sessionId });
    const response = await callback({ sessionId, text: "1" });

    expect(response.text.startsWith("CON ")).toBe(true);
    expect(response.text).toMatch(/main problem/i);
  });

  it("advances to the first question in Kiswahili", async () => {
    const sessionId = newSessionId();
    await callback({ sessionId });
    const response = await callback({ sessionId, text: "2" });
    expect(response.text).toMatch(/Tatizo kuu/i);
  });

  it("ends the dialogue when the caller declines", async () => {
    const sessionId = newSessionId();
    await callback({ sessionId });
    const response = await callback({ sessionId, text: "3" });

    expect(response.text.startsWith("END ")).toBe(true);
    expect(harness.redis.keys().filter((k) => k.includes("channel:ussd:state"))).toEqual([]);
  });
});

describe("USSD accumulated input", () => {
  it("reads only the newest keypress from an accumulating aggregator", async () => {
    const sessionId = newSessionId();
    await callback({ sessionId });
    await callback({ sessionId, text: "1" });
    const response = await callback({ sessionId, text: "1*1" });

    // The second keypress answered the symptom-category question, so the next
    // screen must be a different question.
    expect(response.text).not.toMatch(/main problem/i);
    expect(response.text.startsWith("CON ")).toBe(true);
  });
});

describe("USSD idempotency", () => {
  it("replays the identical screen for an aggregator retry", async () => {
    const sessionId = newSessionId();
    await callback({ sessionId });

    const first = await callback({ sessionId, text: "1" });
    const retry = await callback({ sessionId, text: "1" });

    expect(retry.text).toBe(first.text);
  });

  it("does not advance the dialogue twice on a retry", async () => {
    const sessionId = newSessionId();
    await callback({ sessionId });
    await callback({ sessionId, text: "1" });
    const afterFirst = harness.safety.calls;

    await callback({ sessionId, text: "1" });
    expect(harness.safety.calls).toBe(afterFirst);
  });
});

describe("USSD timeout and restart", () => {
  it("restarts at the disclosure when the dialogue state has expired", async () => {
    const sessionId = newSessionId();
    await callback({ sessionId });
    await callback({ sessionId, text: "1" });

    harness.redis.expireNow(
      channelRedisKeys.ussdState(hasher.hashProviderSessionId(sessionId)),
    );

    // A fresh provider session id, as the aggregator would issue after a
    // timeout, carrying accumulated input that must be ignored.
    const restarted = newSessionId();
    const response = await callback({ sessionId: restarted, text: "1*1" });
    expect(response.text).toMatch(/NOT diagnose/i);
  });
});

describe("USSD safety outcome", () => {
  it("ends immediately with the approved emergency message", async () => {
    harness.safety.next = assessment({ urgency: "emergency" });
    const sessionId = newSessionId();
    await callback({ sessionId });
    const response = await callback({ sessionId, text: "1" });

    expect(response.text.startsWith("END ")).toBe(true);
    expect(response.text).toMatch(/needs emergency care NOW/i);
    expect(response.text).not.toContain("…");
  });

  it("does not leak model wording into the emergency screen", async () => {
    harness.safety.next = assessment({ urgency: "emergency" });
    harness.ai.plannedQuestion = "You probably have appendicitis.";
    const sessionId = newSessionId();
    await callback({ sessionId });
    const response = await callback({ sessionId, text: "1" });
    expect(response.text).not.toMatch(/appendicitis/i);
  });

  it("never reassures when the safety engine is unavailable", async () => {
    harness.safety.fail = true;
    const sessionId = newSessionId();
    await callback({ sessionId });
    const response = await callback({ sessionId, text: "1" });

    expect(response.text).toMatch(/could not complete/i);
    expect(response.text).not.toMatch(/no urgent warning sign/i);
  });
});

describe("USSD malformed input", () => {
  it("answers a signed but malformed body with a safe terminal screen", async () => {
    const raw = encode({ nonsense: "1" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await request(harness.app)
      .post(CALLBACK)
      .set("content-type", "application/x-www-form-urlencoded")
      .set(CHANNEL_TIMESTAMP_HEADER, timestamp)
      .set(CHANNEL_SIGNATURE_HEADER, signChannelPayload(TEST_USSD_SECRET, timestamp, raw))
      .send(raw);

    expect(response.status).toBe(200);
    expect(response.text.startsWith("END ")).toBe(true);
    expect(response.text).toMatch(/temporarily unavailable/i);
  });
});

describe("USSD feature flag", () => {
  it("reports the channel as disabled when the flag is off", async () => {
    harness.dispose();
    harness = createChannelHarness({ ussd: false });
    const response = await callback({ sessionId: newSessionId() });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe("channel_disabled");
  });
});

describe("USSD summary delivery to WhatsApp", () => {
  /**
   * Answers every pathway field with "1" and returns each screen served, so a
   * test can inspect where the offer appeared and what followed it.
   */
  async function completeInterview(sessionId: string): Promise<string[]> {
    const screens: string[] = [];
    screens.push((await callback({ sessionId })).text);
    let accumulated = "1";
    screens.push((await callback({ sessionId, text: accumulated })).text);
    for (let index = 0; index < 10; index += 1) {
      accumulated = `${accumulated}*1`;
      const response = await callback({ sessionId, text: accumulated });
      screens.push(response.text);
      if (response.text.startsWith("END ")) break;
    }
    return screens;
  }

  it("does not offer delivery when the caller has no WhatsApp session", async () => {
    const screens = await completeInterview(newSessionId());
    expect(screens.join("\n")).not.toMatch(/Send it to me on WhatsApp/i);
    expect(harness.redis.keys()).not.toContain(channelRedisKeys.whatsappOutbox());
  });

  it("offers delivery and queues the summary when a WhatsApp session exists", async () => {
    // Seed a WhatsApp session for the same phone number. The hash is derived
    // in the WhatsApp namespace, so it is not the USSD pseudonym.
    const whatsappHash = hasher.hashIdentity("whatsapp", PHONE);
    expect(whatsappHash).not.toBe(hasher.hashIdentity("ussd", PHONE));
    await harness.redis.set(
      channelRedisKeys.identity("whatsapp", whatsappHash),
      JSON.stringify({
        channel: "whatsapp",
        channelUserHash: whatsappHash,
        sessionId: "wa-session",
        locale: "en",
        disclosureVersion: "1.0.0",
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      }),
      "EX",
      600,
    );

    const screens = await completeInterview(newSessionId());
    const joined = screens.join("\n---\n");

    // The offer is a numbered menu on a CON screen.
    expect(joined).toMatch(/1\. Send it to me on WhatsApp/i);
    // Accepting it (the loop keeps pressing "1") queues the summary for the
    // gateway to deliver, and ends the dialogue.
    expect(screens[screens.length - 1]?.startsWith("END ")).toBe(true);

    const queued = await harness.redis.lpop(channelRedisKeys.whatsappOutbox(), 10);
    expect(Array.isArray(queued) ? queued : []).toHaveLength(1);
    const message = JSON.parse((queued as string[])[0] as string);
    expect(message.channel).toBe("whatsapp");
    expect(message.channelUserHash).toBe(whatsappHash);
    // The queued payload carries no phone number and no diagnosis.
    expect(JSON.stringify(message)).not.toContain("254712345678");
  });
});

describe("USSD shares the conversation engine with WhatsApp", () => {
  it("runs the same safety engine that the WhatsApp path runs", async () => {
    const sessionId = newSessionId();
    await callback({ sessionId });
    await callback({ sessionId, text: "1" });
    // The stub is the single shared instance; a USSD-local clinical engine
    // would leave this at zero.
    expect(harness.safety.calls).toBeGreaterThan(0);
  });
});
