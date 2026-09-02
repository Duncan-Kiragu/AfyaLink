import type { KkdSession, MockCallStatus, VoiceCallbackStatus } from "@kkd/contracts";

export type VoiceSessionRecord = {
  session: KkdSession;
  disclosureAcknowledged: boolean;
  closed: boolean;
  mockCallStatus: MockCallStatus;
  callbackStatus: VoiceCallbackStatus;
  callbackIdempotencyKey?: string;
};

const sessions = new Map<string, VoiceSessionRecord>();

export function saveVoiceSession(record: VoiceSessionRecord): void {
  sessions.set(record.session.id, record);
}

export function getVoiceSession(id: string): VoiceSessionRecord | undefined {
  return sessions.get(id);
}

export function deleteVoiceSession(id: string): void {
  sessions.delete(id);
}

export function resetVoiceSessions(): void {
  sessions.clear();
}
