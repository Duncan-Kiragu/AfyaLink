import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchConversationToken } from "./elevenlabs.js";

describe("fetchConversationToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when credentials are missing", async () => {
    await expect(fetchConversationToken({ ELEVENLABS_API_KEY: undefined, ELEVENLABS_AGENT_ID: undefined })).rejects.toThrow(
      "elevenlabs_not_configured",
    );
  });

  it("returns the conversation token from the documented API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        expect(url).toContain("/v1/convai/conversation/token");
        expect(url).toContain("agent_id=agent_test");
        return new Response(JSON.stringify({ token: "tok_live" }), { status: 200 });
      }),
    );

    const result = await fetchConversationToken({
      ELEVENLABS_API_KEY: "sk_test",
      ELEVENLABS_AGENT_ID: "agent_test",
    });
    expect(result).toEqual({ conversationToken: "tok_live", agentId: "agent_test" });
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      headers: { "xi-api-key": "sk_test" },
    });
  });
});
