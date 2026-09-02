import type {
  SafetyAssessment,
  SeverityEvaluationInput,
  UrgencyClass,
} from "@kkd/contracts";
import { evaluateCondition } from "./conditions.js";
import {
  REVIEWED_RULE_STATUSES,
  UNREVIEWED_RULE_STATUSES,
  type SafetyRule,
  type SafetyRuleStatus,
} from "./rule-schema.js";
import { defaultRuleSetRegistry, type RuleSetRegistry } from "./registry.js";

/**
 * Disposition precedence. The most urgent firing rule wins, so no later rule and no
 * later message can downgrade a red flag (spec §8.3.B, §8.4.E).
 */
const URGENCY_PRECEDENCE: Record<UrgencyClass, number> = {
  emergency: 4,
  urgent_today: 3,
  soon: 2,
  monitor: 1,
  unknown: 0,
};

export interface SeverityEvaluationOptions {
  /** Rule sets available for pinning. Defaults to those shipped with the package. */
  registry?: RuleSetRegistry;
  /**
   * Execute `draft` rules, which by definition have no clinical sign-off (spec §8.3.A).
   *
   * Off by default: only `active` rules decide urgency, and `safetyRuleSchema` will not
   * accept an `active` rule without `reviewedBy` and `reviewedAt`. Opt in for tests and
   * rule authoring. Passing this in a patient-facing path means an unreviewed rule is
   * deciding what a patient is told to do.
   */
  executeUnreviewedDraftRules?: boolean;
}

export interface SafetyEngine {
  evaluate(input: SeverityEvaluationInput): SafetyAssessment;
}

/**
 * Deterministic urgency evaluation (spec §8.3.A).
 *
 * Pure and synchronous: no Redis, no Supabase, no network, no session object, no clock
 * read. Spec §8.7 requires safety-critical execution to be synchronous and §2.1 forbids
 * queueing it, so the signature returns a value rather than a Promise.
 *
 * Spec §8.3.A: "Do not let Claude directly return the final urgency class without the
 * rule engine checking/deciding it." This function is the only source of an urgency class.
 *
 * Only clinically reviewed (`active`) rules run unless the caller opts in via
 * `executeUnreviewedDraftRules`.
 *
 * `priorObservations` is accepted and carried by the contract but no rule reads it yet;
 * longitudinal escalation is Slice 9.
 */
export function evaluateSeverity(
  input: SeverityEvaluationInput,
  options: SeverityEvaluationOptions = {},
): SafetyAssessment {
  const { registry = defaultRuleSetRegistry, executeUnreviewedDraftRules = false } =
    options;
  const ruleSet = registry.resolve(input.ruleSetVersion);

  const executableStatuses: readonly SafetyRuleStatus[] = executeUnreviewedDraftRules
    ? [...REVIEWED_RULE_STATUSES, ...UNREVIEWED_RULE_STATUSES]
    : REVIEWED_RULE_STATUSES;

  const context = { symptoms: input.symptoms, facts: input.facts };

  const fired: SafetyRule[] = [];
  for (const rule of ruleSet.rules) {
    if (!executableStatuses.includes(rule.status)) {
      continue;
    }
    if (rule.conditions.every((condition) => evaluateCondition(condition, context))) {
      fired.push(rule);
    }
  }

  // No rule fired means nothing has been established, not that the patient is fine.
  // Spec §8.3.C: return `unknown` "rather than creating false reassurance".
  const urgency: UrgencyClass = fired.reduce<UrgencyClass>(
    (highest, rule) =>
      URGENCY_PRECEDENCE[rule.urgencyResult] > URGENCY_PRECEDENCE[highest]
        ? rule.urgencyResult
        : highest,
    "unknown",
  );

  // Full audit trail: every rule that fired, sorted for stable output (spec §8.7).
  const ruleIds = fired.map((rule) => rule.id).sort();

  // Only the rules that produced the winning disposition explain it, so a lower-urgency
  // message is never attached to a higher-urgency outcome.
  const explanationKeys = [
    ...new Set(
      fired
        .filter((rule) => rule.urgencyResult === urgency)
        .map((rule) => rule.patientMessageKey),
    ),
  ].sort();

  // Any firing rule can demand human escalation; a higher-urgency rule never suppresses it.
  const requiresHumanEscalation = fired.some((rule) => rule.requiresHumanEscalation);

  return {
    urgency,
    ruleIds,
    explanationKeys,
    // Populated by the complaint-pathway required-field tables in Slice 3.
    missingCriticalFacts: [],
    requiresHumanEscalation,
    ruleSetVersion: ruleSet.version,
  };
}

export class DeterministicSafetyEngine implements SafetyEngine {
  constructor(private readonly options: SeverityEvaluationOptions = {}) {}

  evaluate(input: SeverityEvaluationInput): SafetyAssessment {
    return evaluateSeverity(input, this.options);
  }
}
