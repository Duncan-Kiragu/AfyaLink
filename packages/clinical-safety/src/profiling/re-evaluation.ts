import type {
  CheckInAnswer,
  CheckInObservation,
  PriorObservation,
  ReportedFact,
  ReportedSymptom,
  SafetyAssessment,
} from "@kkd/contracts";
import { evaluateSeverity, type SeverityEvaluationOptions } from "../evaluator.js";
import { isRenderableConceptCode } from "./check-in-questions.js";

/**
 * Re-evaluation of a submitted check-in (spec §8.4.E).
 *
 * "Every new check-in must run the same severity engine. A profile cannot suppress a new
 * red flag merely because earlier check-ins were low urgency."
 *
 * The second sentence is a structural property here, not a rule someone remembered to
 * write: `evaluateSeverity` is a pure function of the facts it is handed, this module
 * hands it the *current* check-in's facts, and there is no code path in which a prior
 * urgency is read, compared, or used to filter. Prior observations travel alongside for
 * longitudinal rules to read; they can raise an urgency and have no mechanism to lower
 * one, because the disposition is the maximum over firing rules.
 *
 * Synchronous throughout (spec §8.7, §2.1: urgency is never a job).
 */

/**
 * Carrier for explicitly denied concepts.
 *
 * `ReportedSymptom` records denials as a list on a symptom (spec §5.1), so a check-in in
 * which the patient reports nothing present but denies something still needs one symptom
 * object to hang the denials from. This concept matches no rule and no pathway; it exists
 * so that "no, the vomiting has stopped" is recorded as an answer rather than as silence,
 * which §5.2 forbids reading as denial.
 */
export const CHECK_IN_DENIAL_CARRIER_CONCEPT = "check_in_report";

/** How a `worse_same_better` answer was recorded. */
export const CHECK_IN_CHANGE_FACT_KIND = "checkin.change_since_last";

function answerConcept(answer: CheckInAnswer): string | undefined {
  const conceptCode = answer.conceptCode;
  if (!conceptCode || !isRenderableConceptCode(conceptCode)) {
    return undefined;
  }
  return conceptCode;
}

/**
 * Normalized symptoms for the severity engine, built from one check-in's answers.
 *
 * Every answer is `confidence: "explicit"`: the patient was asked a direct question and
 * answered it. Nothing is inferred, and a question left unanswered produces nothing at
 * all rather than a default.
 */
export function symptomsFromCheckInAnswers(
  answers: readonly CheckInAnswer[],
): ReportedSymptom[] {
  const present = new Map<string, ReportedSymptom>();
  const denied: string[] = [];

  for (const answer of answers) {
    const conceptCode = answerConcept(answer);
    if (!conceptCode) {
      continue;
    }
    if (typeof answer.value === "number") {
      const existing = present.get(conceptCode);
      present.set(conceptCode, {
        ...(existing ?? {
          id: `checkin.${conceptCode}`,
          concept: conceptCode,
          confidence: "explicit" as const,
        }),
        severity: answer.value,
      });
      continue;
    }
    if (typeof answer.value === "boolean") {
      if (answer.value) {
        if (!present.has(conceptCode)) {
          present.set(conceptCode, {
            id: `checkin.${conceptCode}`,
            concept: conceptCode,
            confidence: "explicit",
          });
        }
      } else if (!denied.includes(conceptCode)) {
        denied.push(conceptCode);
      }
    }
  }

  const symptoms = [...present.values()].sort((left, right) =>
    left.concept.localeCompare(right.concept),
  );
  // A concept both rated and denied in the same submission is contradictory. The present
  // reading wins: dropping it could suppress a red flag, which §8.3.C forbids.
  const outstandingDenials = denied.filter((concept) => !present.has(concept));
  if (outstandingDenials.length > 0) {
    symptoms.push({
      id: `checkin.${CHECK_IN_DENIAL_CARRIER_CONCEPT}`,
      concept: CHECK_IN_DENIAL_CARRIER_CONCEPT,
      deniedSymptoms: [...outstandingDenials].sort(),
      confidence: "explicit",
    });
  }
  return symptoms;
}

/**
 * Facts for the severity engine: the patient's own worse/same/better comparisons.
 *
 * Carried as facts rather than folded into severity, because "worse" is what the patient
 * said, and a rule that escalates on a reported worsening should read that, not a number
 * the engine derived on their behalf.
 */
export function factsFromCheckInAnswers(answers: readonly CheckInAnswer[]): ReportedFact[] {
  const facts: ReportedFact[] = [];
  for (const answer of answers) {
    const conceptCode = answerConcept(answer);
    if (!conceptCode || typeof answer.value !== "string") {
      continue;
    }
    if (answer.value !== "worse" && answer.value !== "same" && answer.value !== "better") {
      continue;
    }
    facts.push({
      id: `checkin.change.${conceptCode}`,
      kind: `${CHECK_IN_CHANGE_FACT_KIND}.${conceptCode}`,
      value: answer.value,
      confidence: "explicit",
    });
  }
  return facts.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Observations for the trend layer, built from one check-in's answers.
 *
 * The `id` is supplied by the caller — it is the stored `RecordEntry.id`, so a trend
 * statement can name the rows it was computed from (spec §8.7).
 */
export function observationsFromCheckInAnswers(
  answers: readonly CheckInAnswer[],
  observedAt: string,
  entryIdFor: (answer: CheckInAnswer) => string,
): CheckInObservation[] {
  const byConcept = new Map<string, CheckInObservation>();
  for (const answer of answers) {
    const conceptCode = answerConcept(answer);
    if (!conceptCode) {
      continue;
    }
    const current: CheckInObservation = byConcept.get(conceptCode) ?? {
      id: entryIdFor(answer),
      observedAt,
      conceptCode,
    };
    if (typeof answer.value === "number") {
      byConcept.set(conceptCode, { ...current, severity: answer.value, present: true });
    } else if (typeof answer.value === "boolean") {
      byConcept.set(conceptCode, { ...current, present: answer.value });
    } else if (typeof answer.value === "string") {
      byConcept.set(conceptCode, {
        ...current,
        worseningReported: answer.value === "worse",
      });
    }
  }
  return [...byConcept.values()].sort((left, right) =>
    (left.conceptCode ?? "").localeCompare(right.conceptCode ?? ""),
  );
}

export interface CheckInEvaluation {
  readonly assessment: SafetyAssessment;
  readonly symptoms: readonly ReportedSymptom[];
  readonly facts: readonly ReportedFact[];
}

export interface EvaluateCheckInInput {
  readonly answers: readonly CheckInAnswer[];
  /** Earlier check-ins, oldest first. Passed explicitly so evaluation stays deterministic. */
  readonly priorObservations?: readonly PriorObservation[];
  readonly ruleSetVersion: string;
  readonly answeredAt: string;
}

/**
 * Runs the severity engine on a submitted check-in (spec §8.4.E).
 *
 * Note what is absent: no branch on the prior assessment, no "only escalate", no
 * comparison against a stored urgency. The engine sees this check-in's facts and the
 * history, and decides from scratch every time.
 */
export function evaluateCheckIn(
  input: EvaluateCheckInInput,
  options: SeverityEvaluationOptions = {},
): CheckInEvaluation {
  const symptoms = symptomsFromCheckInAnswers(input.answers);
  const facts = factsFromCheckInAnswers(input.answers);
  const assessment = evaluateSeverity(
    {
      symptoms,
      facts,
      priorObservations: [...(input.priorObservations ?? [])],
      evaluatedAt: input.answeredAt,
      ruleSetVersion: input.ruleSetVersion,
    },
    options,
  );
  return { assessment, symptoms, facts };
}
