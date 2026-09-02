import { describe, expect, it } from "vitest";
import type { CheckInObservation } from "@kkd/contracts";
import { inspectDiagnosisLanguage } from "../diagnosis-language/guard.js";
import {
  buildTrendStatements,
  consecutiveWorseningStatements,
  renderTrendStatementDraft,
  reportFrequencyStatements,
  severityChangeStatements,
} from "./trends.js";

function observation(
  index: number,
  overrides: Partial<CheckInObservation> = {},
): CheckInObservation {
  return {
    id: `entry-${index}`,
    observedAt: `2026-09-0${index}T08:00:00.000Z`,
    conceptCode: "abdominal_pain",
    ...overrides,
  };
}

describe("severity trends (spec §8.4.D)", () => {
  it("reports a decrease across check-ins", () => {
    const statements = severityChangeStatements([
      observation(1, { severity: 7 }),
      observation(2, { severity: 6 }),
      observation(3, { severity: 4 }),
    ]);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.params).toMatchObject({
      conceptCode: "abdominal_pain",
      firstSeverity: 7,
      lastSeverity: 4,
      checkInCount: 3,
      direction: "decreased",
    });
    expect(statements[0]?.observationIds).toEqual(["entry-1", "entry-2", "entry-3"]);
  });

  it("reports an increase", () => {
    const statements = severityChangeStatements([
      observation(1, { severity: 3 }),
      observation(2, { severity: 8 }),
    ]);
    expect(statements[0]?.params.direction).toBe("increased");
  });

  it("says nothing from a single rating or an unchanged one", () => {
    expect(severityChangeStatements([observation(1, { severity: 5 })])).toEqual([]);
    expect(
      severityChangeStatements([observation(1, { severity: 5 }), observation(2, { severity: 5 })]),
    ).toEqual([]);
  });
});

describe("report frequency (spec §8.4.D)", () => {
  it("counts reports over settled check-ins", () => {
    const statements = reportFrequencyStatements([
      observation(1, { conceptCode: "fever", present: true }),
      observation(2, { conceptCode: "fever", present: true }),
      observation(3, { conceptCode: "fever", present: false }),
      observation(4, { conceptCode: "fever", present: true }),
      observation(5, { conceptCode: "fever", present: true }),
    ]);
    expect(statements[0]?.params).toMatchObject({
      conceptCode: "fever",
      reportedCount: 4,
      observationCount: 5,
    });
  });

  it("does not count an unasked check-in as a denial (spec §5.2)", () => {
    const statements = reportFrequencyStatements([
      observation(1, { conceptCode: "fever", present: true }),
      observation(2, { conceptCode: "fever" }),
      observation(3, { conceptCode: "fever", present: true }),
      observation(4, { conceptCode: "fever", present: true }),
    ]);
    expect(statements[0]?.params).toMatchObject({ reportedCount: 3, observationCount: 3 });
  });
});

describe("consecutive worsening (spec §8.4.D)", () => {
  it("reports a current run of worsening marks", () => {
    const statements = consecutiveWorseningStatements([
      observation(1, { worseningReported: false }),
      observation(2, { worseningReported: true }),
      observation(3, { worseningReported: true }),
    ]);
    expect(statements[0]?.params).toMatchObject({ consecutiveCount: 2 });
    expect(statements[0]?.observationIds).toEqual(["entry-2", "entry-3"]);
  });

  it("ignores a run that has since been broken", () => {
    expect(
      consecutiveWorseningStatements([
        observation(1, { worseningReported: true }),
        observation(2, { worseningReported: true }),
        observation(3, { worseningReported: false }),
      ]),
    ).toEqual([]);
  });
});

describe("trend statements are factual and non-diagnostic (spec §8.6, §8.7)", () => {
  const history: CheckInObservation[] = [
    observation(1, { severity: 7, present: true, worseningReported: true }),
    observation(2, { severity: 6, present: true, worseningReported: true }),
    observation(3, { severity: 4, present: true, worseningReported: true }),
  ];

  it("passes every statement it emits through the diagnosis-language guard", () => {
    const { statements, suppressed } = buildTrendStatements(history);
    expect(statements.length).toBeGreaterThan(0);
    expect(suppressed).toEqual([]);
    for (const statement of statements) {
      const verdict = inspectDiagnosisLanguage({
        text: renderTrendStatementDraft(statement),
        surface: "trend_statement",
        locale: "en",
      });
      expect(verdict.coverage).toBe("checked");
      expect(verdict.allowed).toBe(true);
    }
  });

  it("suppresses a statement whose patient-derived data carries a condition claim", () => {
    // A concept code the extraction layer should never produce. If one ever reaches the
    // trend layer, the sentence a patient would read must not ship.
    const contaminated = history.map((item) => ({
      ...item,
      conceptCode: "you_have_malaria",
    }));
    const { statements, suppressed } = buildTrendStatements(contaminated);
    expect(statements).toEqual([]);
    expect(suppressed.length).toBeGreaterThan(0);
    expect(suppressed[0]?.patternIds.length).toBeGreaterThan(0);
  });

  it("emits nothing for a locale the guard has no patterns for, rather than unchecked text", () => {
    const { statements, suppressed } = buildTrendStatements(history, { locale: "sw" });
    expect(statements).toEqual([]);
    expect(suppressed.length).toBeGreaterThan(0);
  });

  it("is deterministic for the same observations", () => {
    const first = buildTrendStatements(history).statements;
    const second = buildTrendStatements(history).statements;
    expect(second).toEqual(first);
  });

  it("carries keys and data, never a rendered sentence", () => {
    for (const statement of buildTrendStatements(history).statements) {
      expect(statement.statementKey).toMatch(/^trend\.[a-z_]+$/);
      expect(statement.observationIds.length).toBeGreaterThan(0);
      expect(Object.values(statement.params).every((value) => !/\s/.test(String(value)))).toBe(
        true,
      );
    }
  });
});
