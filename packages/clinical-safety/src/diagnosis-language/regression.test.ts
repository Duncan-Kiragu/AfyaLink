import {
  diagnosisLanguageRegressionCases,
  regressionSuiteFolders,
  type DiagnosisLanguageRegressionCase,
} from "@kkd/testing";
import { describe, expect, it } from "vitest";
import { inspectDiagnosisLanguage } from "./guard.js";

const assertable = diagnosisLanguageRegressionCases.filter(
  (c) => c.blockedOn === undefined,
);
const blocked = diagnosisLanguageRegressionCases.filter((c) => c.blockedOn !== undefined);

function run(testCase: DiagnosisLanguageRegressionCase) {
  return inspectDiagnosisLanguage({
    text: testCase.text,
    surface: testCase.surface,
    locale: testCase.locale,
  });
}

/**
 * Spec §8.6: "no diagnostic language in severity or trend statements".
 *
 * The corpus lives in `@kkd/testing` so the cases are shared, versioned, and reviewable
 * by the people who own the other channels (spec §21.3, §10.4.D).
 */
describe("diagnosis-language regression corpus", () => {
  it("is not empty and covers both surfaces in both directions", () => {
    expect(assertable.length).toBeGreaterThan(0);
    for (const surface of ["urgency_explanation", "trend_statement"] as const) {
      for (const expected of ["prohibited", "allowed"] as const) {
        expect(
          assertable.some((c) => c.surface === surface && c.expected === expected),
        ).toBe(true);
      }
    }
  });

  it("uses only declared folders and unique ids", () => {
    const ids = new Set<string>();
    for (const testCase of diagnosisLanguageRegressionCases) {
      expect(regressionSuiteFolders).toContain(testCase.folder);
      expect(ids.has(testCase.id)).toBe(false);
      ids.add(testCase.id);
    }
  });

  it.each(assertable.map((c) => [c.id, c] as const))("%s", (_id, testCase) => {
    const verdict = run(testCase);

    expect(verdict.allowed).toBe(testCase.expected === "allowed");
  });
});

/**
 * Cases carried in the corpus that cannot pass yet. They are listed rather than asserted,
 * so the gap is visible in test output instead of living in someone's notes.
 */
describe("known gaps", () => {
  it("records why each blocked case is blocked", () => {
    for (const testCase of blocked) {
      expect(testCase.blockedOn).toBeTruthy();
    }
  });

  it.each(blocked.map((c) => [c.id, c] as const))(
    "%s is refused rather than passed",
    (_id, testCase) => {
      // Not caught by a pattern, but the guard must still not call it clean: an
      // unsupported locale fails closed.
      const verdict = run(testCase);

      expect(verdict.allowed).toBe(false);
    },
  );
});
