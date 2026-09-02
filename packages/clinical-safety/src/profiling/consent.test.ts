import { describe, expect, it } from "vitest";
import { CHECK_IN_CONSENT_DISCLOSURE, PROFILE_CONSENT_VERSION } from "@kkd/contracts";
import {
  checkInConsentDecision,
  contactsPerWeek,
  currentCheckInDisclosure,
  isCheckInConsentActive,
  isDeliverableCheckInChannel,
  isWithinDisclosedFrequency,
  type CheckInConsentState,
} from "./consent.js";

const granted: CheckInConsentState = {
  version: PROFILE_CONSENT_VERSION,
  channel: "web",
  grantedAt: "2026-09-01T08:00:00.000Z",
};

describe("check-in consent (spec §8.4.A)", () => {
  it("refuses before anything is granted", () => {
    expect(checkInConsentDecision(undefined)).toEqual({
      allowed: false,
      reason: "not_granted",
    });
  });

  it("allows an active grant and reports the selected channel", () => {
    expect(checkInConsentDecision(granted)).toEqual({ allowed: true, channel: "web" });
  });

  it("refuses immediately once withdrawn", () => {
    const withdrawn = { ...granted, withdrawnAt: "2026-09-02T08:00:00.000Z" };
    expect(isCheckInConsentActive(withdrawn)).toBe(false);
    expect(checkInConsentDecision(withdrawn).allowed).toBe(false);
  });

  it("refuses a grant against a superseded disclosure", () => {
    expect(checkInConsentDecision({ ...granted, version: "profile.checkins.v0" })).toEqual({
      allowed: false,
      reason: "version_superseded",
    });
  });
});

describe("disclosure (spec §8.4.A)", () => {
  it("shows what will be stored, the contact ceiling, channels and how to withdraw", () => {
    const disclosure = currentCheckInDisclosure();
    expect(disclosure).toBe(CHECK_IN_CONSENT_DISCLOSURE);
    expect(disclosure.storedDataKeys.length).toBeGreaterThan(0);
    expect(disclosure.maxContactsPerWeek).toBeGreaterThan(0);
    expect(disclosure.availableChannels).toContain("web");
    expect(disclosure.withdrawalKey).toBeTruthy();
    expect(disclosure.consentVersion).toBe(PROFILE_CONSENT_VERSION);
  });

  it("carries i18n keys, never patient-facing sentences", () => {
    for (const key of [
      ...CHECK_IN_CONSENT_DISCLOSURE.storedDataKeys,
      CHECK_IN_CONSENT_DISCLOSURE.withdrawalKey,
    ]) {
      expect(key).toMatch(/^[a-z][a-z0-9_.]*$/);
      expect(key).not.toContain(" ");
    }
  });

  it("only offers channels that can actually deliver in V1", () => {
    for (const channel of CHECK_IN_CONSENT_DISCLOSURE.availableChannels) {
      expect(isDeliverableCheckInChannel(channel)).toBe(true);
    }
    expect(isDeliverableCheckInChannel("whatsapp")).toBe(false);
    expect(isDeliverableCheckInChannel("voice")).toBe(false);
  });
});

describe("contact frequency ceiling", () => {
  it("counts contacts per week per cadence", () => {
    expect(contactsPerWeek({ kind: "daily" })).toBe(7);
    expect(contactsPerWeek({ kind: "weekly" })).toBe(1);
    expect(contactsPerWeek({ kind: "custom_interval", intervalDays: 2 })).toBe(3.5);
    expect(contactsPerWeek({ kind: "custom_once", dueAt: "2026-09-05T08:00:00.000Z" })).toBe(1);
  });

  it("accepts every cadence within the disclosed ceiling", () => {
    expect(isWithinDisclosedFrequency({ kind: "daily" })).toBe(true);
    expect(isWithinDisclosedFrequency({ kind: "weekly" })).toBe(true);
    expect(isWithinDisclosedFrequency({ kind: "custom_interval", intervalDays: 1 })).toBe(true);
  });

  it("refuses a cadence more frequent than the patient was shown", () => {
    expect(
      isWithinDisclosedFrequency(
        { kind: "daily" },
        { ...CHECK_IN_CONSENT_DISCLOSURE, maxContactsPerWeek: 1 },
      ),
    ).toBe(false);
  });
});
