import type {
  GuardedSurface,
  LocalePatternSet,
  ProhibitedPattern,
} from "./pattern-schema.js";
import { enPatternsV0_1_0Draft } from "./patterns/en.v0.1.0-draft.js";

/**
 * Prohibited-pattern sets, keyed by locale.
 *
 * Adding Kiswahili (spec §10.4.D, jointly with Brian) means writing
 * `patterns/sw.v0.1.0-draft.ts` and registering it here. No guard code changes.
 */
export class ProhibitedPatternRegistry {
  readonly #sets = new Map<string, LocalePatternSet>();

  constructor(sets: readonly LocalePatternSet[] = []) {
    for (const set of sets) {
      this.register(set);
    }
  }

  register(set: LocalePatternSet): void {
    const key = normalizeLocale(set.locale);
    if (this.#sets.has(key)) {
      throw new Error(
        `Prohibited patterns for locale ${set.locale} are already registered`,
      );
    }
    this.#sets.set(key, set);
  }

  /**
   * Resolves a locale tag to a pattern set, falling back from a region-specific tag to
   * its primary subtag ("en-KE" -> "en"). Returns `undefined` rather than substituting
   * another locale: text nobody can check must not be waved through.
   */
  resolve(locale: string): LocalePatternSet | undefined {
    const key = normalizeLocale(locale);
    const exact = this.#sets.get(key);
    if (exact) {
      return exact;
    }
    const primary = key.split("-")[0];
    return primary && primary !== key ? this.#sets.get(primary) : undefined;
  }

  /** Patterns for one locale and one surface, in declaration order. */
  patternsFor(locale: string, surface: GuardedSurface): readonly ProhibitedPattern[] {
    const set = this.resolve(locale);
    if (!set) {
      return [];
    }
    return set.patterns.filter((pattern) => pattern.surfaces.includes(surface));
  }

  locales(): string[] {
    return [...this.#sets.keys()].sort();
  }
}

function normalizeLocale(locale: string): string {
  return locale.trim().toLowerCase();
}

/** Locales shipped with the package. English only — see `docs/clinical-rules/README.md`. */
export const defaultProhibitedPatternRegistry = new ProhibitedPatternRegistry([
  enPatternsV0_1_0Draft,
]);
