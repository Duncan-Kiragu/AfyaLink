import { describe, expect, it } from "vitest";
import { BULLMQ_PREFIX, defaultJobOptions } from "./index.js";

describe("@kkd/queue", () => {
  it("uses the spec BullMQ prefix", () => {
    expect(BULLMQ_PREFIX).toBe("kkd:bull");
  });

  it("retries with exponential backoff and keeps failed jobs for review", () => {
    expect(defaultJobOptions.attempts).toBeGreaterThanOrEqual(3);
    expect(defaultJobOptions.backoff).toEqual({ type: "exponential", delay: 1000 });
    expect(defaultJobOptions.removeOnFail.count).toBeGreaterThan(0);
  });
});
