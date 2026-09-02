import { complaintPathwaySchema, type ComplaintPathway } from "./pathway-schema.js";
import { safetyRuleSchema, type SafetyRule } from "./rule-schema.js";
import { complaintPathwaysV0_1_0Draft } from "./rule-sets/complaint-pathways.v0.1.0-draft.js";
import {
  RED_FLAGS_V0_1_0_DRAFT_VERSION,
  redFlagsV0_1_0Draft,
} from "./rule-sets/red-flags.v0.1.0-draft.js";

/**
 * A pinned, immutable set of rules and the complaint-pathway tables reviewed with them.
 *
 * Spec §8.7: "every decision identifies rule IDs/version internally". A rule set
 * version, once used in production, is immutable — mirroring the rule §6.3.D states
 * for score algorithm versions. Changing a rule means publishing a new version.
 *
 * Pathways are pinned by the same version rather than versioned separately, so the one
 * `ruleSetVersion` on a `SafetyAssessment` identifies everything that decided it: the
 * disposition and the `missingCriticalFacts` alike.
 */
export interface RuleSet {
  readonly version: string;
  readonly rules: readonly SafetyRule[];
  /** Required-field tables per presenting complaint (spec §8.3.B step 4). */
  readonly pathways: readonly ComplaintPathway[];
}

export class UnknownRuleSetVersionError extends Error {
  constructor(readonly requestedVersion: string) {
    super(`Unknown safety rule set version: ${requestedVersion}`);
    this.name = "UnknownRuleSetVersionError";
  }
}

/**
 * Validates a rule set at construction. A malformed or unreviewed-but-active rule or
 * pathway is a load-time failure, never a silent runtime skip.
 */
export function defineRuleSet(
  version: string,
  rules: readonly SafetyRule[],
  pathways: readonly ComplaintPathway[] = [],
): RuleSet {
  const parsedRules = rules.map((rule) => safetyRuleSchema.parse(rule));
  const ruleIds = new Set<string>();
  for (const rule of parsedRules) {
    if (ruleIds.has(rule.id)) {
      throw new Error(`Duplicate rule id "${rule.id}" in rule set ${version}`);
    }
    ruleIds.add(rule.id);
  }

  const parsedPathways = pathways.map((pathway) => complaintPathwaySchema.parse(pathway));
  const pathwayIds = new Set<string>();
  for (const pathway of parsedPathways) {
    if (pathwayIds.has(pathway.id)) {
      throw new Error(`Duplicate pathway id "${pathway.id}" in rule set ${version}`);
    }
    pathwayIds.add(pathway.id);
  }

  return Object.freeze({
    version,
    rules: Object.freeze(parsedRules),
    pathways: Object.freeze(parsedPathways),
  });
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
  complaintPathwaysV0_1_0Draft,
);

/** Rule sets shipped with the package. */
export const defaultRuleSetRegistry = new RuleSetRegistry([redFlagsRuleSet]);

export { RED_FLAGS_V0_1_0_DRAFT_VERSION };
