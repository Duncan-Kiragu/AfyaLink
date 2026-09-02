import { describe, expect, it } from "vitest";
import { processAnalytics } from "./analytics.js";

describe("processAnalytics", () => {
  it("accepts the queue probe job", async () => {
    await expect(
      processAnalytics({ kind: "queue_probe", idempotencyKey: "probe-1" }),
    ).resolves.toBeUndefined();
  });

  it("rejects a payload that includes an event body", async () => {
    await expect(
      processAnalytics({
        kind: "queue_probe",
        idempotencyKey: "probe-1",
        patientText: "abdominal pain",
      }),
    ).rejects.toThrow();
  });
});
