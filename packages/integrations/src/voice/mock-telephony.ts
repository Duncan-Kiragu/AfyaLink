import type { MockCallStatus } from "@kkd/contracts";

export type MockTelephonyEvent = {
  sessionId: string;
  providerEventId: string;
  status: MockCallStatus;
};

const seenEventIds = new Set<string>();

export function applyMockTelephonyEvent(event: MockTelephonyEvent): {
  applied: boolean;
  duplicate: boolean;
} {
  if (seenEventIds.has(event.providerEventId)) {
    return { applied: false, duplicate: true };
  }
  seenEventIds.add(event.providerEventId);
  return { applied: true, duplicate: false };
}

export function resetMockTelephonyEvents(): void {
  seenEventIds.clear();
}
