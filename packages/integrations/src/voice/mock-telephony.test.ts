import { describe, expect, it } from "vitest";
import { applyMockTelephonyEvent, resetMockTelephonyEvents } from "./mock-telephony.js";

describe("mock telephony", () => {
  it("is idempotent on duplicate provider event ids", () => {
    resetMockTelephonyEvents();
    const event = {
      sessionId: "s1",
      providerEventId: "evt-1",
      status: "in_progress" as const,
    };
    expect(applyMockTelephonyEvent(event).duplicate).toBe(false);
    expect(applyMockTelephonyEvent(event).duplicate).toBe(true);
  });
});
