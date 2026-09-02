import type { ConversationChannelAdapter, ExternalApiAdapter } from "@kkd/contracts";

export type { ConversationChannelAdapter, ExternalApiAdapter };
export {
  applyMockTelephonyEvent,
  fetchConversationToken,
  processVoiceJob,
  resetMockTelephonyEvents,
  VOICE_ADAPTER,
} from "./voice/index.js";

export const adapterFolders = ["geo", "providers", "whatsapp", "ussd", "voice"] as const;

export function unimplementedAdapter(name: string): never {
  throw new Error(`@kkd/integrations ${name} adapter is not implemented`);
}

export * from "./channel/index.js";
