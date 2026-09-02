/** KKD-VOICE-001: mint a short-lived conversation token; never expose the API key to the browser. */
export const VOICE_ADAPTER = "voice";
export { fetchConversationToken } from "./elevenlabs.js";
export {
  applyMockTelephonyEvent,
  resetMockTelephonyEvents,
  type MockTelephonyEvent,
} from "./mock-telephony.js";
export { processVoiceJob } from "./jobs.js";
