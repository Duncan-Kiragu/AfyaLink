export {
  REVIEWED_RULE_STATUSES,
  UNREVIEWED_RULE_STATUSES,
  safetyRuleConditionSchema,
  safetyRuleFactValueSchema,
  safetyRuleSchema,
  safetyRuleStatusSchema,
  type SafetyRule,
  type SafetyRuleCondition,
  type SafetyRuleFactValue,
  type SafetyRuleStatus,
} from "./rule-schema.js";

export {
  evaluateCondition,
  normalizeConcept,
  type ConditionContext,
} from "./conditions.js";

export {
  complaintPathwaySchema,
  requiredFieldEstablishmentSchema,
  requiredFieldSchema,
  symptomAttributeSchema,
  REQUIRED_FIELD_ID_PATTERN,
  type ComplaintPathway,
  type RequiredField,
  type RequiredFieldEstablishment,
  type SymptomAttribute,
} from "./pathway-schema.js";

export {
  activePathways,
  isFieldEstablished,
  missingCriticalFields,
  type MissingCriticalField,
} from "./pathways.js";

export {
  defaultRuleSetRegistry,
  defineRuleSet,
  redFlagsRuleSet,
  RED_FLAGS_V0_1_0_DRAFT_VERSION,
  RuleSetRegistry,
  UnknownRuleSetVersionError,
  type RuleSet,
} from "./registry.js";

export {
  DeterministicSafetyEngine,
  evaluateSeverity,
  missingCriticalFieldsFor,
  nextRequiredQuestion,
  type SafetyEngine,
  type SeverityEvaluationOptions,
} from "./evaluator.js";

/**
 * Post-generation guard over patient-facing model output (spec §14).
 * Implementation is Slice 4; ownership is still open (spec §10.4.D says "Evans/Antonia").
 */
export interface DiagnosisLanguageGuard {
  inspect(text: string, locale: string): Promise<{ allowed: boolean; reason?: string }>;
}
