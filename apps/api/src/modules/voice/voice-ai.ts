import {
  createAiServiceFromEnv,
  type KkdAiService,
  type SessionContextReader,
} from "@kkd/ai";
import { loadEnv } from "@kkd/config";
import { createPiiServiceFromEnv } from "@kkd/pii";
import { getVoiceSession } from "./voice.store.js";

export const voiceSessionContext: SessionContextReader = {
  async load(sessionId) {
    const record = getVoiceSession(sessionId);
    if (!record) {
      throw new Error("voice_session_not_found");
    }
    return {
      facts: record.session.facts,
      symptoms: record.session.symptoms,
      missingFieldIds: record.session.completion.missingFieldIds,
      urgency: record.session.safety.urgency,
    };
  },
};

let voiceAi: KkdAiService | undefined;

export function getVoiceAi(): KkdAiService {
  if (!voiceAi) {
    const env = loadEnv();
    const pii = createPiiServiceFromEnv(env);
    voiceAi = createAiServiceFromEnv(env, pii, voiceSessionContext);
  }
  return voiceAi;
}

export function aiExtractionEnabled(): boolean {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return false;
  }
  return Boolean(loadEnv().ANTHROPIC_API_KEY);
}
