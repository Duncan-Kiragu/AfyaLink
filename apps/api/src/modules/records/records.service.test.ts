import { beforeEach, describe, expect, it } from "vitest";
import { RECORDS_CONSENT_VERSION } from "@kkd/contracts";
import {
  computeAndStoreScore,
  createRecord,
  grantConsent,
  persistSelectedFacts,
} from "./records.service.js";
import { resetRecordStore } from "./records.store.js";

const USER_A = "11111111-1111-4111-8111-111111111111";

describe("records.service persist boundary", () => {
  beforeEach(() => {
    resetRecordStore();
  });

  it("hashes a source session id and never stores the raw value", async () => {
    await grantConsent(USER_A, RECORDS_CONSENT_VERSION);
    const record = await createRecord(USER_A, { label: "save selected facts" });
    const result = await persistSelectedFacts(USER_A, record.id, {
      consentVersion: RECORDS_CONSENT_VERSION,
      sourceChannel: "web",
      sourceSessionId: "visible-ephemeral-id",
      facts: [
        {
          entryType: "symptom",
          conceptCode: "primary_experience",
          patientWording: "Nausea and reduced appetite",
          effectiveAt: "2026-09-02T08:00:00.000Z",
          confidence: "explicit",
        },
      ],
    });
    expect(result.entries[0]?.sourceSessionIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("visible-ephemeral-id");
  });

  it("does not raise completeness when a field is only inferred", async () => {
    await grantConsent(USER_A, RECORDS_CONSENT_VERSION);
    const record = await createRecord(USER_A, {});
    const inferred = await computeAndStoreScore(USER_A, record.id, {
      urgencyClass: "monitor",
      requiredFieldIds: ["primary_experience", "onset_or_duration", "location"],
      answeredFieldIds: ["primary_experience", "onset_or_duration", "location"],
      inferredFieldIds: ["location"],
    });
    const explicit = await computeAndStoreScore(USER_A, record.id, {
      urgencyClass: "monitor",
      requiredFieldIds: ["primary_experience", "onset_or_duration", "location"],
      answeredFieldIds: ["primary_experience", "onset_or_duration"],
    });
    expect(inferred.completenessPercent).toBe(67);
    expect(explicit.completenessPercent).toBe(67);
    expect(inferred.algorithmVersion).toBe(explicit.algorithmVersion);
  });
});
