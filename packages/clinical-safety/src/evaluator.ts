import type {
  SafetyAssessment,
  SeverityEvaluationInput,
  UrgencyClass,
} from "@kkd/contracts";
import { evaluateCondition } from "./conditions.js";
import { EXECUTABLE_RULE_STATUSES, type SafetyRule } from "./rule-schema.js";
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
 * `priorObservations` is accepted and carried by the contract but no rule reads it yet;
 * longitudinal escalation is Slice 9.
 */
export function evaluateSeverity(
  input: SeverityEvaluationInput,
  registry: RuleSetRegistry = defaultRuleSetRegistry,
): SafetyAssessment {
  const ruleSet = registry.resolve(input.ruleSetVersion);

  const fired: SafetyRule[] = [];
  for (const rule of ruleSet.rules) {
    if (!EXECUTABLE_RULE_STATUSES.includes(rule.status)) {
      continue;
    }
    if (
      rule.conditions.every((condition) => evaluateCondition(condition, input.symptoms))
    ) {
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
  constructor(private readonly registry: RuleSetRegistry = defaultRuleSetRegistry) {}

  evaluate(input: SeverityEvaluationInput): SafetyAssessment {
    return evaluateSeverity(input, this.registry);
  }
}
