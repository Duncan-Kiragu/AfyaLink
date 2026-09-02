import { describe, expect, it } from "vitest";
import { processPurges } from "./purges.js";

const job = {
  kind: "record_purge_verify" as const,
  idempotencyKey: "record-purge:22222222-2222-4222-8222-222222222222",
  recordId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
};

describe("processPurges", () => {
  it("accepts a record purge verification job without clinical content", async () => {
    await expect(processPurges(job)).resolves.toBeUndefined();
  });

  it("fails when dependent rows remain", async () => {
    await expect(processPurges(job, { remainingRows: async () => 2 })).rejects.toThrow(
      "purge_dependents_remain",
    );
  });

  it("passes when dependents are gone", async () => {
    await expect(processPurges(job, { remainingRows: async () => 0 })).resolves.toBeUndefined();
  });

  it("deletes a session key by id without requiring a payload body", async () => {
    await expect(
      processPurges({
        kind: "session_purge",
        idempotencyKey: "session-purge:11111111-1111-4111-8111-111111111111",
        sessionId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toBeUndefined();
  });
});
