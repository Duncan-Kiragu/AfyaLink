import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedInboundMessage } from "@kkd/contracts";
import {
  CHANNEL_SIGNATURE_HEADER,
  CHANNEL_TIMESTAMP_HEADER,
  verifyChannelSignature,
} from "@kkd/integrations/channel";
import { KkdApiClient, KkdApiError } from "./api-client.js";

const SECRET = "g".repeat(48);

const message: NormalizedInboundMessage = {
  channel: "whatsapp",
  provider: "baileys",
  channelUserHash: "hash-1",
  providerMessageId: "MSG1",
  text: "chest pain",
};

function client(): KkdApiClient {
  return new KkdApiClient({ baseUrl: "https://api.test", secret: SECRET });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

type FetchInput = Parameters<typeof fetch>[0];

function stubFetch(handler: (input: FetchInput, init?: RequestInit) => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: FetchInput, init?: RequestInit) => handler(input, init)),
  );
}

describe("KkdApiClient", () => {
  it("signs the exact bytes it sends, so the API can verify them", async () => {
    let verified = false;
    stubFetch((_input, init) => {
      const headers = new Headers(init?.headers);
      const raw = String(init?.body ?? "");
      verified = verifyChannelSignature({
        secret: SECRET,
        rawBody: raw,
        signature: headers.get(CHANNEL_SIGNATURE_HEADER) ?? undefined,
        timestamp: headers.get(CHANNEL_TIMESTAMP_HEADER) ?? undefined,
      }).valid;
      return Response.json({ messages: [] });
    });

    await client().submitInbound(message);
    expect(verified).toBe(true);
  });

  it("returns the replies the API authored", async () => {
    stubFetch(() =>
      Response.json({
        messages: [
          {
            channel: "whatsapp",
            channelUserHash: "hash-1",
            text: "What are you experiencing?",
            choices: [],
            choiceLabels: {},
            locale: "en",
            urgent: false,
            terminal: false,
          },
        ],
      }),
    );

    const replies = await client().submitInbound(message);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toBe("What are you experiencing?");
  });

  it("rejects a response that does not match the outbound contract", async () => {
    // A malformed reply must not be sent to a patient.
    stubFetch(() => Response.json({ messages: [{ text: 42 }] }));
    await expect(client().submitInbound(message)).rejects.toThrow();
  });

  it("surfaces the API status and error code without inventing a reply", async () => {
    stubFetch(() => Response.json({ error: "duplicate_in_flight" }, { status: 409 }));
    await expect(client().submitInbound(message)).rejects.toMatchObject({
      name: "KkdApiError",
      status: 409,
      code: "duplicate_in_flight",
    });
  });

  it("reports a KkdApiError when the API is unavailable", async () => {
    stubFetch(() => new Response("", { status: 503 }));
    await expect(client().submitInbound(message)).rejects.toBeInstanceOf(KkdApiError);
  });

  it("signs the empty body for a GET so the outbox drain is authenticated too", async () => {
    let valid = false;
    stubFetch((_input, init) => {
      const headers = new Headers(init?.headers);
      valid = verifyChannelSignature({
        secret: SECRET,
        rawBody: "",
        signature: headers.get(CHANNEL_SIGNATURE_HEADER) ?? undefined,
        timestamp: headers.get(CHANNEL_TIMESTAMP_HEADER) ?? undefined,
      }).valid;
      return Response.json({ messages: [] });
    });

    await client().drainOutbox();
    expect(valid).toBe(true);
  });
});
