import { describe, expect, it } from "vitest";
import type { RecordExportBundle } from "@kkd/contracts";
import { processExports } from "./exports.js";

const job = {
  kind: "record_export" as const,
  idempotencyKey: "record-export:11111111-1111-4111-8111-111111111111",
  jobId: "11111111-1111-4111-8111-111111111111",
  recordId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  format: "json" as const,
};

const bundle: RecordExportBundle = {
  exportedAt: "2026-09-02T12:00:00.000Z",
  notice:
    "This export contains patient-reported facts and process scores only. It does not contain a condition label or a predicted-condition score.",
  record: {
    id: job.recordId,
    userId: job.userId,
    createdAt: "2026-09-02T11:00:00.000Z",
  },
  entries: [],
  scores: [],
};

describe("processExports", () => {
  it("accepts a metadata-only record export job", async () => {
    await expect(processExports(job)).resolves.toBeUndefined();
  });

  it("rejects a payload that includes export content", async () => {
    await expect(
      processExports({
        ...job,
        bundle: { symptoms: "abdominal pain" },
      }),
    ).rejects.toThrow();
  });

  it("writes generated JSON through the store hook", async () => {
    const written: string[] = [];
    await processExports(job, {
      buildBundle: async () => bundle,
      putBundle: async (_job, generated) => {
        written.push(JSON.stringify(generated));
      },
    });
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("does not contain a condition label");
    expect(written[0]).not.toMatch(/malaria|diagnosis/i);
  });
});
