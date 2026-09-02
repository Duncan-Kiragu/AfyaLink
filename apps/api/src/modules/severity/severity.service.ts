import { evaluateSeverity, UnknownRuleSetVersionError } from "@kkd/clinical-safety";
import { loadEnv } from "@kkd/config";
import type { SafetyAssessment, SeverityEvaluationInput } from "@kkd/contracts";
import { assertSafeEvent, createLogger } from "@kkd/observability";
import { httpError } from "../../lib/http-error.js";

const log = createLogger("api.severity");

/**
 * `ruleSetVersion` on the conservative failure response (spec §20).
 *
 * A failure response is not a rule-engine decision, so it must not claim a rule set
 * version that a reader could replay. Together with an empty `ruleIds` this is how a
 * consumer tells a degraded response apart from an assessment.
 */
export const SEVERITY_ENGINE_UNAVAILABLE_VERSION = "unavailable";

/** i18n key for the §20 failure message. Reviewed wording is Brian's (spec §10.4.A). */
export const SEVERITY_FAILURE_EXPLANATION_KEY = "severity.failure.seek_professional_care";

/**
 * Spec §20, "Safety engine error": *"Conservative approved failure response; direct to
 * professional care where appropriate; emit critical operational alert."*
 *
 * `urgent_today` rather than `unknown`. §20 requires the response to direct the patient
 * to professional care, and `unknown` does not route anywhere — a consumer reading only
 * `urgency` would render a failed evaluation as an absence of findings, which is the
 * false reassurance §8.3.C exists to prevent. `emergency` is not used either: nothing
 * was established that justifies emergency care, and over-escalating every engine fault
 * to an ambulance is its own harm.
 *
 * This is deliberately not a rule-engine output, and it says so: `ruleIds` is empty and
 * `ruleSetVersion` is `unavailable`. It does not violate §8.3.A ("do not let Claude
 * directly return the final urgency class") — no model is involved; it is a fixed
 * conservative constant for the case where the deciding engine did not run.
 *
 * `missingCriticalFacts` is empty because a failed engine cannot enumerate what it would
 * have needed. Empty here means "cannot say", not "nothing missing".
 *
 * Wording still requires clinical sign-off (spec §8.3.D). Only the key ships.
 */
function conservativeFailureAssessment(): SafetyAssessment {
  return {
    urgency: "urgent_today",
    ruleIds: [],
    explanationKeys: [SEVERITY_FAILURE_EXPLANATION_KEY],
    missingCriticalFacts: [],
    requiresHumanEscalation: true,
    ruleSetVersion: SEVERITY_ENGINE_UNAVAILABLE_VERSION,
  };
}

/**
 * Runs the deterministic engine synchronously (spec §8.7, §2.1 — urgency is never a job).
 *
 * A pinned rule set the registry does not know is a caller error, not an engine fault:
 * it is rejected with 400 rather than answered with a conservative disposition, so a
 * typo in `ruleSetVersion` never reads as a clinical finding.
 *
 * Any other throw is the §20 safety-engine-error path.
 */
export function evaluateSeverityRequest(
  input: SeverityEvaluationInput,
  requestId?: string,
): SafetyAssessment {
  const env = loadEnv();
  try {
    return evaluateSeverity(input, {
      executeUnreviewedDraftRules: env.FEATURE_SEVERITY_UNREVIEWED_DRAFT_RULES,
    });
  } catch (error) {
    if (error instanceof UnknownRuleSetVersionError) {
      throw httpError("unknown_rule_set_version", 400);
    }
    // Critical operational alert (spec §20). Safe fields only — the input that caused
    // the failure is symptom data and never reaches a log (spec §18).
    log.fatal(
      assertSafeEvent({ event: "safety_engine_failure", requestId, status: "error" }),
      "safety engine failed; returning conservative disposition",
    );
    return conservativeFailureAssessment();
  }
}

/**
 * Privacy-safe telemetry (spec §18): urgency and rule ids only.
 *
 * `assertSafeEvent` drops anything outside `SAFE_EVENT_KEYS`, so no symptom text, no
 * request body and no PII can leave here even by accident. `SAFE_EVENT_KEYS` carries a
 * single `ruleId`, so a multi-rule assessment emits one event per fired rule — which is
 * also the shape §18's "safety-rule failures" metric needs.
 */
export function emitSeverityTelemetry(
  assessment: SafetyAssessment,
  requestId?: string,
): void {
  log.info(
    assertSafeEvent({
      event: "severity_evaluated",
      requestId,
      urgency: assessment.urgency,
      status:
        assessment.ruleSetVersion === SEVERITY_ENGINE_UNAVAILABLE_VERSION
          ? "degraded"
          : "ok",
    }),
  );
  for (const ruleId of assessment.ruleIds) {
    log.info(
      assertSafeEvent({
        event: "severity_rule_fired",
        requestId,
        urgency: assessment.urgency,
        ruleId,
      }),
    );
  }
}
