import { describe, expect, it } from "vitest";
import { processFollowups } from "./followups.js";

describe("processFollowups", () => {
  it("validates the metadata-only payload then refuses to run", async () => {
    await expect(
      processFollowups({
        kind: "followup_due",
        idempotencyKey: "f1",
        scheduleId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toThrow(/not implemented/);
  });
});
