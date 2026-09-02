import { safetyRuleSchema, type SafetyRule } from "./rule-schema.js";
import {
  RED_FLAGS_V0_1_0_DRAFT_VERSION,
  redFlagsV0_1_0Draft,
} from "./rule-sets/red-flags.v0.1.0-draft.js";

/**
 * A pinned, immutable set of rules.
 *
 * Spec §8.7: "every decision identifies rule IDs/version internally". A rule set
 * version, once used in production, is immutable — mirroring the rule §6.3.D states
 * for score algorithm versions. Changing a rule means publishing a new version.
 */
export interface RuleSet {
  readonly version: string;
  readonly rules: readonly SafetyRule[];
}

export class UnknownRuleSetVersionError extends Error {
  constructor(readonly requestedVersion: string) {
    super(`Unknown safety rule set version: ${requestedVersion}`);
    this.name = "UnknownRuleSetVersionError";
  }
}

/**
 * Validates a rule set at construction. A malformed or unreviewed-but-active rule is a
 * load-time failure, never a silent runtime skip.
 */
export function defineRuleSet(version: string, rules: readonly SafetyRule[]): RuleSet {
  const parsed = rules.map((rule) => safetyRuleSchema.parse(rule));
  const ids = new Set<string>();
  for (const rule of parsed) {
    if (ids.has(rule.id)) {
      throw new Error(`Duplicate rule id "${rule.id}" in rule set ${version}`);
    }
    ids.add(rule.id);
  }
  return Object.freeze({ version, rules: Object.freeze(parsed) });
}

export class RuleSetRegistry {
  readonly #ruleSets = new Map<string, RuleSet>();

  constructor(ruleSets: readonly RuleSet[] = []) {
    for (const ruleSet of ruleSets) {
      this.register(ruleSet);
    }
  }

  register(ruleSet: RuleSet): void {
    if (this.#ruleSets.has(ruleSet.version)) {
      throw new Error(`Rule set version ${ruleSet.version} is already registered`);
    }
    this.#ruleSets.set(ruleSet.version, ruleSet);
  }

  /** Resolves an exact version. Never falls back to "latest" — pinning is the point. */
  resolve(version: string): RuleSet {
    const ruleSet = this.#ruleSets.get(version);
    if (!ruleSet) {
      throw new UnknownRuleSetVersionError(version);
    }
    return ruleSet;
  }

  versions(): string[] {
    return [...this.#ruleSets.keys()].sort();
  }
}

export const redFlagsRuleSet = defineRuleSet(
  RED_FLAGS_V0_1_0_DRAFT_VERSION,
  redFlagsV0_1_0Draft,
);

/** Rule sets shipped with the package. */
export const defaultRuleSetRegistry = new RuleSetRegistry([redFlagsRuleSet]);

export { RED_FLAGS_V0_1_0_DRAFT_VERSION };
