import type { CheckInObservation, CheckInQuestion } from "@kkd/contracts";

/**
 * Check-in question construction (spec §8.4.C).
 *
 * "Each check-in should be based on previously reported facts, not a disease label."
 * Enforced structurally rather than by review: the only input is the patient's own prior
 * observations, and the only thing that varies between one patient's questions and
 * another's is a concept code and a number they themselves reported. There is nowhere
 * for a condition label to enter, because nothing here consults a rule, a pathway, or a
 * model — only what was already recorded.
 *
 * Questions are i18n keys plus data. No English sentence is produced: reviewed wording
 * is Brian's (spec §10.4.A), and §8.3.D's requirement for clinical review of exact
 * wording applies to anything a patient reads.
 *
 * Pure: no clock, no storage. The caller supplies the observations.
 */

/**
 * A concept code the check-in layer will put in front of a patient.
 *
 * Normalized codes only — lowercase, underscore-separated, no spaces or punctuation.
 * The extraction layer produces these; free patient wording does not travel into a
 * question. A patient who says "my malaria is worse" cannot thereby make KKD ask them
 * about a condition, because the wording never becomes a concept code and an unnormalized
 * code is skipped rather than rendered.
 */
const CONCEPT_CODE_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function isRenderableConceptCode(conceptCode: string): boolean {
  return CONCEPT_CODE_PATTERN.test(conceptCode) && conceptCode.length <= 64;
}

export interface CheckInQuestionOptions {
  /**
   * Most questions a single check-in may ask.
   *
   * A check-in is a follow-up, not a fresh intake. Asking twelve questions of someone
   * who is unwell suppresses answers, and an unanswered check-in produces no
   * observations at all — so the cap protects the longitudinal data as well as the
   * patient.
   */
  readonly maxQuestions?: number;
}

/** The latest observation per concept, most recently observed concept first. */
function latestByConcept(
  observations: readonly CheckInObservation[],
): CheckInObservation[] {
  const latest = new Map<string, CheckInObservation>();
  for (const observation of observations) {
    const conceptCode = observation.conceptCode;
    if (!conceptCode || !isRenderableConceptCode(conceptCode)) {
      continue;
    }
    const existing = latest.get(conceptCode);
    if (!existing || existing.observedAt.localeCompare(observation.observedAt) < 0) {
      latest.set(conceptCode, observation);
    }
  }
  return [...latest.values()].sort(
    (left, right) =>
      right.observedAt.localeCompare(left.observedAt) ||
      (left.conceptCode ?? "").localeCompare(right.conceptCode ?? ""),
  );
}

/**
 * The questions for one check-in occurrence, built from what this patient last reported.
 *
 * Per concept, in order of preference:
 *
 * - a rated concept is asked for its rating again ("you rated it 6/10, what is it now?"),
 *   because a comparable number is what makes §8.4.D's severity trend possible at all;
 * - an unrated concept that was reported present is asked whether it is still there
 *   ("have you vomited since the last check-in?");
 * - a concept explicitly denied last time is not asked again, and no question is
 *   invented for a concept the patient never raised.
 *
 * Every concept also gets the patient's own worse/same/better comparison, which is what
 * §8.4.D's "marked as worsening" statement reports.
 *
 * Returns `[]` when there is nothing to follow up. An empty check-in is correct: there
 * is no generic health questionnaire to fall back on, and inventing one would be asking
 * about facts the patient never reported.
 */
export function buildCheckInQuestions(
  observations: readonly CheckInObservation[],
  options: CheckInQuestionOptions = {},
): CheckInQuestion[] {
  const { maxQuestions = 6 } = options;
  const questions: CheckInQuestion[] = [];

  for (const observation of latestByConcept(observations)) {
    const conceptCode = observation.conceptCode as string;
    // Explicitly denied last time: settled, and re-asking would read as disbelief.
    if (observation.present === false) {
      continue;
    }

    if (observation.severity !== undefined) {
      questions.push({
        id: `${conceptCode}.severity`,
        questionKey: "checkin.question.severity_now",
        params: {
          conceptCode,
          previousSeverity: observation.severity,
          previousObservedAt: observation.observedAt,
        },
        answerShape: "severity_0_10",
        conceptCode,
        sourceEntryIds: [observation.id],
      });
    } else {
      questions.push({
        id: `${conceptCode}.present`,
        questionKey: "checkin.question.still_present",
        params: { conceptCode, previousObservedAt: observation.observedAt },
        answerShape: "yes_no",
        conceptCode,
        sourceEntryIds: [observation.id],
      });
    }

    questions.push({
      id: `${conceptCode}.change`,
      questionKey: "checkin.question.change_since_last",
      params: { conceptCode, previousObservedAt: observation.observedAt },
      answerShape: "worse_same_better",
      conceptCode,
      sourceEntryIds: [observation.id],
    });
  }

  return questions.slice(0, maxQuestions);
}
