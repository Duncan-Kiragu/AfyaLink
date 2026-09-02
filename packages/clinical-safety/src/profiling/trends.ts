import type { CheckInObservation, TrendStatement } from "@kkd/contracts";
import {
  inspectDiagnosisLanguage,
  type DiagnosisLanguageGuardOptions,
} from "../diagnosis-language/guard.js";

/**
 * Trend statements over stored check-in observations (spec §8.4.D).
 *
 * Pure functions over an observation array: no clock, no storage, no network. The
 * caller supplies the observations, so the same history always produces the same
 * statements.
 *
 * Everything here is a description of what the patient reported. Nothing counts,
 * compares, or projects towards a condition — §8.4.D's prohibited examples ("this
 * pattern means you have X", "your likelihood of X is increasing") are not merely
 * unwritten, they are unreachable: no function takes or produces a condition label.
 */

/** Observations for one concept, oldest first. */
function byConcept(
  observations: readonly CheckInObservation[],
): Map<string, CheckInObservation[]> {
  const grouped = new Map<string, CheckInObservation[]>();
  for (const observation of observations) {
    if (!observation.conceptCode) {
      continue;
    }
    const bucket = grouped.get(observation.conceptCode);
    if (bucket) {
      bucket.push(observation);
    } else {
      grouped.set(observation.conceptCode, [observation]);
    }
  }
  for (const bucket of grouped.values()) {
    bucket.sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  }
  return grouped;
}

/**
 * "Your reported pain scores have decreased from 7 to 4 over three check-ins."
 *
 * Needs at least two rated observations of the same concept, and says nothing when the
 * rating did not move: "unchanged" reads as reassurance, and §8.3.C's rule against
 * manufacturing reassurance from an absence applies to trends as much as to urgency.
 */
export function severityChangeStatements(
  observations: readonly CheckInObservation[],
): TrendStatement[] {
  const statements: TrendStatement[] = [];
  for (const [conceptCode, bucket] of byConcept(observations)) {
    const rated = bucket.filter((item) => item.severity !== undefined);
    if (rated.length < 2) {
      continue;
    }
    const first = rated[0];
    const last = rated[rated.length - 1];
    if (
      first?.severity === undefined ||
      last?.severity === undefined ||
      first.severity === last.severity
    ) {
      continue;
    }
    statements.push({
      kind: "severity_change",
      statementKey: "trend.severity_change",
      params: {
        conceptCode,
        firstSeverity: first.severity,
        lastSeverity: last.severity,
        checkInCount: rated.length,
        direction: last.severity > first.severity ? "increased" : "decreased",
      },
      observationIds: rated.map((item) => item.id),
    });
  }
  return statements;
}

/**
 * "You reported fever on four of the last five check-ins."
 *
 * Counts only observations that settled the question either way — `present` true or
 * false. An observation that never asked about the concept is not a denial (spec §5.2),
 * so it is neither numerator nor denominator.
 */
export function reportFrequencyStatements(
  observations: readonly CheckInObservation[],
  minimumObservations = 3,
): TrendStatement[] {
  const statements: TrendStatement[] = [];
  for (const [conceptCode, bucket] of byConcept(observations)) {
    const settled = bucket.filter((item) => item.present !== undefined);
    if (settled.length < minimumObservations) {
      continue;
    }
    const reported = settled.filter((item) => item.present === true);
    if (reported.length === 0) {
      continue;
    }
    statements.push({
      kind: "report_frequency",
      statementKey: "trend.report_frequency",
      params: {
        conceptCode,
        reportedCount: reported.length,
        observationCount: settled.length,
      },
      observationIds: settled.map((item) => item.id),
    });
  }
  return statements;
}

/**
 * "This symptom has been marked as worsening for two consecutive check-ins."
 *
 * Reports the patient's own marking, not an inference from severity numbers. The run
 * must be the most recent observations of that concept, so a resolved earlier episode
 * is not reported as if it were current.
 */
export function consecutiveWorseningStatements(
  observations: readonly CheckInObservation[],
  minimumRun = 2,
): TrendStatement[] {
  const statements: TrendStatement[] = [];
  for (const [conceptCode, bucket] of byConcept(observations)) {
    const marked = bucket.filter((item) => item.worseningReported !== undefined);
    const run: CheckInObservation[] = [];
    for (let index = marked.length - 1; index >= 0; index -= 1) {
      const observation = marked[index];
      if (!observation || observation.worseningReported !== true) {
        break;
      }
      run.unshift(observation);
    }
    if (run.length < minimumRun) {
      continue;
    }
    statements.push({
      kind: "consecutive_worsening",
      statementKey: "trend.consecutive_worsening",
      params: { conceptCode, consecutiveCount: run.length },
      observationIds: run.map((item) => item.id),
    });
  }
  return statements;
}

/**
 * A draft English rendering of a statement, used **only** as input to the
 * diagnosis-language guard.
 *
 * This is not a source of patient-facing copy and must never be rendered to a patient:
 * reviewed strings live in `@kkd/i18n` and are Brian's (spec §10.4.A). It exists because
 * the guard checks text, while a statement is a key plus data — and the data is exactly
 * where an unreviewed string can enter a patient-facing surface. Interpolating here
 * means the guard sees the sentence a patient would actually read, with this patient's
 * concept codes in it, rather than a template that is safe by construction.
 */
export function renderTrendStatementDraft(statement: TrendStatement): string {
  const concept = String(statement.params.conceptCode ?? "").replace(/_/g, " ");
  switch (statement.kind) {
    case "severity_change":
      return `Your reported ${concept} ratings have ${String(statement.params.direction)} from ${String(statement.params.firstSeverity)} to ${String(statement.params.lastSeverity)} over ${String(statement.params.checkInCount)} check-ins.`;
    case "report_frequency":
      return `You reported ${concept} on ${String(statement.params.reportedCount)} of the last ${String(statement.params.observationCount)} check-ins.`;
    case "consecutive_worsening":
      // Passive, matching §8.4.D's own allowed example. "You have marked…" trips the
      // guard's possession pattern ("you have …"), which is the guard working as
      // intended: the approved wording avoids that frame and so does this.
      return `${concept} has been marked as worsening on ${String(statement.params.consecutiveCount)} consecutive check-ins.`;
  }
}

export interface TrendBuildOptions extends DiagnosisLanguageGuardOptions {
  /** BCP-47 locale the statements will be rendered in. Defaults to `en`. */
  readonly locale?: string;
  /** Minimum settled observations before a frequency statement is worth making. */
  readonly minimumObservations?: number;
}

export interface TrendBuildResult {
  readonly statements: readonly TrendStatement[];
  /** Statements the guard refused, with the pattern ids that refused them. */
  readonly suppressed: readonly { statement: TrendStatement; patternIds: string[] }[];
}

/**
 * Builds every trend statement the observations support, then refuses any the
 * diagnosis-language guard rejects (spec §8.6, "no diagnostic language in severity or
 * trend statements"; §8.7, "trends are factual and non-diagnostic").
 *
 * The guard runs on output rather than on templates because the templates are not the
 * risk. A concept code comes from patient-reported data, and a patient who says "my
 * malaria is worse" can put a condition label into a trend sentence that no reviewer
 * ever wrote. Guarding the interpolated draft catches that; guarding the template alone
 * would not.
 *
 * The guard fails closed on a locale it has no patterns for, so an unsupported locale
 * yields no statements rather than unchecked ones.
 */
export function buildTrendStatements(
  observations: readonly CheckInObservation[],
  options: TrendBuildOptions = {},
): TrendBuildResult {
  const { locale = "en", minimumObservations, ...guardOptions } = options;
  const candidates = [
    ...severityChangeStatements(observations),
    ...reportFrequencyStatements(observations, minimumObservations),
    ...consecutiveWorseningStatements(observations),
  ].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      String(left.params.conceptCode).localeCompare(String(right.params.conceptCode)),
  );

  const statements: TrendStatement[] = [];
  const suppressed: { statement: TrendStatement; patternIds: string[] }[] = [];
  for (const statement of candidates) {
    const verdict = inspectDiagnosisLanguage(
      {
        text: renderTrendStatementDraft(statement),
        surface: "trend_statement",
        locale,
      },
      guardOptions,
    );
    if (verdict.allowed) {
      statements.push(statement);
    } else {
      suppressed.push({
        statement,
        patternIds: verdict.findings.map((finding) => finding.patternId),
      });
    }
  }
  return { statements, suppressed };
}
