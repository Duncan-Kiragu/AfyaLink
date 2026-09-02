import { describe, expect, it } from "vitest";
import { processExports } from "./exports.js";

describe("processExports", () => {
  it("accepts a metadata-only record export job", async () => {
    await expect(
      processExports({
        kind: "record_export",
        idempotencyKey: "record-export:11111111-1111-4111-8111-111111111111",
        jobId: "11111111-1111-4111-8111-111111111111",
        recordId: "22222222-2222-4222-8222-222222222222",
        userId: "33333333-3333-4333-8333-333333333333",
        format: "json",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a payload that includes export content", async () => {
    await expect(
      processExports({
        kind: "record_export",
        idempotencyKey: "x",
        jobId: "11111111-1111-4111-8111-111111111111",
        recordId: "22222222-2222-4222-8222-222222222222",
        userId: "33333333-3333-4333-8333-333333333333",
        format: "json",
        bundle: { symptoms: "abdominal pain" },
      }),
    ).rejects.toThrow();
  });
});
