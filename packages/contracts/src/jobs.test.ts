import { describe, expect, it } from "vitest";
import {
  analyticsJobSchema,
  followupJobSchema,
  notificationJobSchema,
  providerSyncJobSchema,
  purgeJobPayloadSchema,
  recordExportJobSchema,
} from "./jobs.js";

describe("job payloads", () => {
  it("rejects clinical content on a record export job", () => {
    const result = recordExportJobSchema.safeParse({
      kind: "record_export",
      idempotencyKey: "x",
      jobId: "11111111-1111-4111-8111-111111111111",
      recordId: "22222222-2222-4222-8222-222222222222",
      userId: "33333333-3333-4333-8333-333333333333",
      format: "json",
      transcript: "abdominal pain",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a notification body or phone number", () => {
    const result = notificationJobSchema.safeParse({
      kind: "notification",
      idempotencyKey: "n1",
      channel: "whatsapp",
      templateId: "check_in.v1",
      phone: "+254712345678",
      body: "How is the pain?",
    });
    expect(result.success).toBe(false);
  });

  it("accepts metadata-only followup, provider-sync, analytics, and purge jobs", () => {
    expect(
      followupJobSchema.parse({
        kind: "followup_due",
        idempotencyKey: "f1",
        scheduleId: "11111111-1111-4111-8111-111111111111",
        userId: "22222222-2222-4222-8222-222222222222",
      }).kind,
    ).toBe("followup_due");
    expect(
      providerSyncJobSchema.parse({
        kind: "provider_sync",
        idempotencyKey: "p1",
        source: "approved_directory",
      }).source,
    ).toBe("approved_directory");
    expect(analyticsJobSchema.parse({ kind: "queue_probe", idempotencyKey: "probe-1" }).kind).toBe(
      "queue_probe",
    );
    expect(
      purgeJobPayloadSchema.parse({
        kind: "session_purge",
        idempotencyKey: "session-purge:11111111-1111-4111-8111-111111111111",
        sessionId: "11111111-1111-4111-8111-111111111111",
      }).kind,
    ).toBe("session_purge");
    expect(
      purgeJobPayloadSchema.parse({
        kind: "record_purge_verify",
        idempotencyKey: "record-purge:22222222-2222-4222-8222-222222222222",
        recordId: "22222222-2222-4222-8222-222222222222",
        userId: "33333333-3333-4333-8333-333333333333",
      }).kind,
    ).toBe("record_purge_verify");
  });
});
