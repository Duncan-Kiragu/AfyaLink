import { describe, expect, it } from "vitest";
import { processPurges } from "./purges.js";

describe("processPurges", () => {
  it("accepts a record purge verification job without clinical content", async () => {
    await expect(
      processPurges({
        kind: "record_purge_verify",
        idempotencyKey: "record-purge:22222222-2222-4222-8222-222222222222",
        recordId: "22222222-2222-4222-8222-222222222222",
        userId: "33333333-3333-4333-8333-333333333333",
      }),
    ).resolves.toBeUndefined();
  });
});
