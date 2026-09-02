import type {
  SafetyAssessment,
  SeverityEvaluationInput,
  UnknownReason,
  UrgencyClass,
} from "@kkd/contracts";
import { evaluateCondition, type ConditionContext } from "./conditions.js";
import {
  activePathways,
  missingCriticalFields,
  type MissingCriticalField,
} from "./pathways.js";
import {
  REVIEWED_RULE_STATUSES,
  UNREVIEWED_RULE_STATUSES,
  type SafetyRule,
  type SafetyRuleStatus,
} from "./rule-schema.js";
import {
  defaultRuleSetRegistry,
  type RuleSet,
  type RuleSetRegistry,
} from "./registry.js";
import type { ComplaintPathway } from "./pathway-schema.js";

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
   * Execute `draft` rules *and* `draft` complaint pathways, which by definition have no
   * clinical sign-off (spec §8.3.A).
   *
   * Off by default: only `active` content runs, and neither `safetyRuleSchema` nor
   * `complaintPathwaySchema` will accept an `active` entry without `reviewedBy` and
   * `reviewedAt`. Opt in for tests and rule authoring. Passing this in a patient-facing
   * path means unreviewed clinical content is deciding what a patient is told to do, and
   * which questions they are asked.
   *
   * A pathway is gated as tightly as a rule because a *completed* pathway is what
   * licenses §8.3.D's "no urgent warning sign has been identified" wording. From an
   * unreviewed table, that sentence would be a guess.
   */
  executeUnreviewedDraftRules?: boolean;
}

export interface SafetyEngine {
  evaluate(input: SeverityEvaluationInput): SafetyAssessment;
}

interface ExecutionContext {
  readonly ruleSet: RuleSet;
  readonly executableStatuses: readonly SafetyRuleStatus[];
  readonly context: ConditionContext;
}

/**
 * Resolves the pinned rule set and the clinical content that may run against it. Shared
 * by every entry point so a disposition and the questions offered alongside it can never
 * come from different rule sets or different review states.
 */
function resolveExecution(
  input: SeverityEvaluationInput,
  options: SeverityEvaluationOptions,
): ExecutionContext {
  const { registry = defaultRuleSetRegistry, executeUnreviewedDraftRules = false } =
    options;
  return {
    ruleSet: registry.resolve(input.ruleSetVersion),
    executableStatuses: executeUnreviewedDraftRules
      ? [...REVIEWED_RULE_STATUSES, ...UNREVIEWED_RULE_STATUSES]
      : REVIEWED_RULE_STATUSES,
    context: { symptoms: input.symptoms, facts: input.facts },
  };
}

/** Pathways activated by the reported facts, skipping any the caller may not run. */
function executablePathways({
  ruleSet,
  executableStatuses,
  context,
}: ExecutionContext): readonly ComplaintPathway[] {
  return activePathways(
    ruleSet.pathways.filter((pathway) => executableStatuses.includes(pathway.status)),
    context,
  );
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
  const execution = resolveExecution(input, options);
  const { ruleSet, executableStatuses, context } = execution;

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

  // Spec §8.3.B step 4: "identify critical missing facts for the current complaint
  // pathway". Reported at every urgency, not only at `unknown` — but step 3 requires the
  // approved safety message before further questioning once a threshold is met.
  const pathways = executablePathways(execution);
  const missing = missingCriticalFields(pathways, context);

  return {
    urgency,
    ruleIds,
    explanationKeys,
    missingCriticalFacts: missing.map((field) => field.fieldId),
    requiresHumanEscalation,
    ruleSetVersion: ruleSet.version,
    ...(urgency === "unknown"
      ? { unknownReason: unknownReason(pathways.length, missing.length) }
      : {}),
  };
}

/**
 * Which kind of `unknown` this is (spec §8.3.C).
 *
 * "We asked everything and found no red flag" and "we cannot tell, because critical
 * information is missing" are both `unknown` under the §8.2 enum. Only the first may
 * ever be phrased as reassurance, so the engine says which one it means rather than
 * leaving the caller to guess.
 */
function unknownReason(pathwayCount: number, missingCount: number): UnknownReason {
  if (missingCount > 0) {
    return "missing_critical_facts";
  }
  if (pathwayCount === 0) {
    // Nothing reported activates a pathway, so the engine cannot even enumerate what it
    // would need. Silence about what is missing is not evidence that nothing is.
    return "no_pathway_matched";
  }
  return "screened_no_rule_matched";
}

/**
 * The detail behind `SafetyAssessment.missingCriticalFacts`: the same fields, in the same
 * order, with the question key that would establish each one.
 *
 * `missingCriticalFacts` is `string[]` by spec §8.2, so the question keys travel here
 * instead. Same purity guarantees as `evaluateSeverity`.
 */
export function missingCriticalFieldsFor(
  input: SeverityEvaluationInput,
  options: SeverityEvaluationOptions = {},
): readonly MissingCriticalField[] {
  const execution = resolveExecution(input, options);

  return missingCriticalFields(executablePathways(execution), execution.context);
}

/**
 * The single highest-priority question still worth asking, or `undefined` when the
 * active pathways are complete (spec §8.3.B step 5, §8.6 "asks a required question").
 */
export function nextRequiredQuestion(
  input: SeverityEvaluationInput,
  options: SeverityEvaluationOptions = {},
): MissingCriticalField | undefined {
  return missingCriticalFieldsFor(input, options)[0];
}

export class DeterministicSafetyEngine implements SafetyEngine {
  constructor(private readonly options: SeverityEvaluationOptions = {}) {}

  evaluate(input: SeverityEvaluationInput): SafetyAssessment {
    return evaluateSeverity(input, this.options);
  }
}
