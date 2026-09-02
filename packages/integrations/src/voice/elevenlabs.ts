import type { Env } from "@kkd/config";

const CONVAI_TOKEN_PATH = "/v1/convai/conversation/token";
const API_ORIGIN = "https://api.elevenlabs.io";

export type ElevenLabsConversationCredentials = {
  conversationToken: string;
  agentId: string;
};

function elevenLabsDetailStatus(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("detail" in body)) {
    return undefined;
  }
  const detail = body.detail;
  if (typeof detail === "object" && detail !== null && "status" in detail && typeof detail.status === "string") {
    return /^[a-z0-9_]{1,64}$/i.test(detail.status) ? detail.status : undefined;
  }
  return undefined;
}

export async function fetchConversationToken(
  env: Pick<Env, "ELEVENLABS_API_KEY" | "ELEVENLABS_AGENT_ID">,
): Promise<ElevenLabsConversationCredentials> {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  const agentId = env.ELEVENLABS_AGENT_ID?.trim();
  if (!apiKey || !agentId) {
    throw new Error("elevenlabs_not_configured");
  }

  const url = new URL(CONVAI_TOKEN_PATH, API_ORIGIN);
  url.searchParams.set("agent_id", agentId);

  const response = await fetch(url, {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) {
    let code = `elevenlabs_token_failed:${response.status}`;
    try {
      const status = elevenLabsDetailStatus(await response.json());
      if (status) {
        code = `${code}:${status}`;
      }
    } catch {
      /* body is not JSON; keep the HTTP status only */
    }
    throw new Error(code);
  }

  const body: unknown = await response.json();
  const token =
    typeof body === "object" &&
    body !== null &&
    "token" in body &&
    typeof body.token === "string"
      ? body.token
      : undefined;

  if (!token) {
    throw new Error("elevenlabs_token_invalid");
  }

  return { conversationToken: token, agentId };
}
