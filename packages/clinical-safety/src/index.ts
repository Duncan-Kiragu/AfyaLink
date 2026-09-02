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

export {
  anyOf,
  defineLocalePatternSet,
  GUARDED_SURFACES,
  guardedSurfaceSchema,
  near,
  prohibitedPattern,
  prohibitedPatternCategorySchema,
  prohibitedPatternSchema,
  words,
  type GuardedSurface,
  type LocalePatternSet,
  type ProhibitedPattern,
  type ProhibitedPatternCategory,
} from "./diagnosis-language/pattern-schema.js";

export {
  defaultProhibitedPatternRegistry,
  ProhibitedPatternRegistry,
} from "./diagnosis-language/registry.js";

export {
  enPatternsV0_1_0Draft,
  EN_PATTERNS_V0_1_0_DRAFT_VERSION,
} from "./diagnosis-language/patterns/en.v0.1.0-draft.js";

export {
  DeterministicDiagnosisLanguageGuard,
  inspectDiagnosisLanguage,
  normalizeForMatching,
  type DiagnosisLanguageCoverage,
  type DiagnosisLanguageFinding,
  type DiagnosisLanguageGuard,
  type DiagnosisLanguageGuardOptions,
  type DiagnosisLanguageInspection,
  type DiagnosisLanguageVerdict,
} from "./diagnosis-language/guard.js";
