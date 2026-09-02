import { describe, expect, it } from "vitest";
import type { FollowUpSchedule } from "@kkd/contracts";
import {
  completeOccurrence,
  firstDueAt,
  InvalidInstantError,
  isDue,
  nextDueAt,
  occurrenceId,
  withdrawSchedule,
} from "./schedule.js";

const SCHEDULE_ID = "33333333-3333-4333-8333-333333333333";

function schedule(overrides: Partial<FollowUpSchedule> = {}): FollowUpSchedule {
  return {
    id: SCHEDULE_ID,
    userId: "11111111-1111-4111-8111-111111111111",
    recordId: "22222222-2222-4222-8222-222222222222",
    cadence: { kind: "daily" },
    status: "active",
    channel: "web",
    consentVersion: "profile.checkins.v1",
    startAt: "2026-09-01T08:00:00.000Z",
    nextDueAt: "2026-09-02T08:00:00.000Z",
    createdAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("nextDueAt", () => {
  it("is a pure function of cadence, anchor and the supplied clock", () => {
    const first = nextDueAt({ kind: "daily" }, "2026-09-01T08:00:00.000Z", "2026-09-03T09:00:00.000Z");
    const again = nextDueAt({ kind: "daily" }, "2026-09-01T08:00:00.000Z", "2026-09-03T09:00:00.000Z");
    expect(first).toBe("2026-09-04T08:00:00.000Z");
    expect(again).toBe(first);
  });

  it("advances daily, weekly and custom intervals from the anchor", () => {
    const anchor = "2026-09-01T08:00:00.000Z";
    const now = "2026-09-01T09:00:00.000Z";
    expect(nextDueAt({ kind: "daily" }, anchor, now)).toBe("2026-09-02T08:00:00.000Z");
    expect(nextDueAt({ kind: "weekly" }, anchor, now)).toBe("2026-09-08T08:00:00.000Z");
    expect(nextDueAt({ kind: "custom_interval", intervalDays: 3 }, anchor, now)).toBe(
      "2026-09-04T08:00:00.000Z",
    );
  });

  it("skips missed occurrences instead of queuing them up", () => {
    // Away for a week on a daily schedule: one next occurrence, not seven.
    expect(
      nextDueAt({ kind: "daily" }, "2026-09-01T08:00:00.000Z", "2026-09-08T10:00:00.000Z"),
    ).toBe("2026-09-09T08:00:00.000Z");
  });

  it("returns the start when the series has not begun", () => {
    expect(
      nextDueAt({ kind: "weekly" }, "2026-09-10T08:00:00.000Z", "2026-09-01T08:00:00.000Z"),
    ).toBe("2026-09-10T08:00:00.000Z");
  });

  it("gives a one-off check-in exactly once", () => {
    const cadence = { kind: "custom_once", dueAt: "2026-09-05T08:00:00.000Z" } as const;
    expect(nextDueAt(cadence, "2026-09-01T08:00:00.000Z", "2026-09-04T08:00:00.000Z")).toBe(
      "2026-09-05T08:00:00.000Z",
    );
    expect(
      nextDueAt(cadence, "2026-09-01T08:00:00.000Z", "2026-09-06T08:00:00.000Z"),
    ).toBeUndefined();
  });

  it("refuses an unparseable instant rather than computing from NaN", () => {
    expect(() => nextDueAt({ kind: "daily" }, "not-a-date", "2026-09-01T08:00:00.000Z")).toThrow(
      InvalidInstantError,
    );
  });

  it("never reads the system clock", () => {
    // A cadence anchored in the far past is only ever evaluated against the supplied
    // instant, so the result cannot move with wall-clock time.
    const evaluated = nextDueAt(
      { kind: "daily" },
      "2020-01-01T00:00:00.000Z",
      "2020-01-05T12:00:00.000Z",
    );
    expect(evaluated).toBe("2020-01-06T00:00:00.000Z");
  });
});

describe("firstDueAt", () => {
  it("makes a schedule starting now immediately due", () => {
    const at = "2026-09-01T08:00:00.000Z";
    expect(firstDueAt({ kind: "daily" }, at, at)).toBe(at);
  });

  it("honours a future start", () => {
    expect(firstDueAt({ kind: "daily" }, "2026-09-05T08:00:00.000Z", "2026-09-01T08:00:00.000Z")).toBe(
      "2026-09-05T08:00:00.000Z",
    );
  });
});

describe("isDue", () => {
  it("is due at and after the due instant", () => {
    expect(isDue(schedule(), "2026-09-02T07:59:59.000Z")).toBe(false);
    expect(isDue(schedule(), "2026-09-02T08:00:00.000Z")).toBe(true);
    expect(isDue(schedule(), "2026-09-03T08:00:00.000Z")).toBe(true);
  });

  it("is never due once withdrawn or completed, whatever the stored due date says", () => {
    expect(isDue(schedule({ status: "withdrawn" }), "2026-09-30T08:00:00.000Z")).toBe(false);
    expect(isDue(schedule({ status: "completed" }), "2026-09-30T08:00:00.000Z")).toBe(false);
  });
});

describe("completeOccurrence", () => {
  it("advances a repeating schedule past the answered occurrence", () => {
    const advanced = completeOccurrence(schedule(), "2026-09-02T09:00:00.000Z");
    expect(advanced.nextDueAt).toBe("2026-09-03T08:00:00.000Z");
    expect(advanced.status).toBe("active");
    expect(advanced.lastCompletedAt).toBe("2026-09-02T09:00:00.000Z");
  });

  it("completes a one-off schedule so it never becomes due again", () => {
    const once = schedule({
      cadence: { kind: "custom_once", dueAt: "2026-09-02T08:00:00.000Z" },
    });
    const advanced = completeOccurrence(once, "2026-09-02T09:00:00.000Z");
    expect(advanced.status).toBe("completed");
    expect(advanced.nextDueAt).toBeUndefined();
    expect(isDue(advanced, "2026-09-30T08:00:00.000Z")).toBe(false);
  });

  it("does not mutate the schedule it is given", () => {
    const original = schedule();
    completeOccurrence(original, "2026-09-02T09:00:00.000Z");
    expect(original.nextDueAt).toBe("2026-09-02T08:00:00.000Z");
  });
});

describe("withdrawSchedule", () => {
  it("clears the due date as well as the status", () => {
    const withdrawn = withdrawSchedule(schedule());
    expect(withdrawn.status).toBe("withdrawn");
    expect(withdrawn.nextDueAt).toBeUndefined();
  });
});

describe("occurrenceId", () => {
  it("is stable and normalizes the instant", () => {
    expect(occurrenceId(SCHEDULE_ID, "2026-09-02T08:00:00Z")).toBe(
      `${SCHEDULE_ID}:2026-09-02T08:00:00.000Z`,
    );
    expect(occurrenceId(SCHEDULE_ID, "2026-09-02T08:00:00.000Z")).toBe(
      occurrenceId(SCHEDULE_ID, "2026-09-02T08:00:00Z"),
    );
  });
});
