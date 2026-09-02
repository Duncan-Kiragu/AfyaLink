import type { GuardedSurface, ProhibitedPatternCategory } from "./pattern-schema.js";
import {
  defaultProhibitedPatternRegistry,
  type ProhibitedPatternRegistry,
} from "./registry.js";

/**
 * What the caller is asking the guard to check.
 *
 * A request object rather than positional arguments, so a later field cannot silently
 * reorder an existing call site. `surface` is required: there is no "check everything"
 * mode, because a guard that does not know what it is looking at cannot know which
 * patterns apply.
 */
export interface DiagnosisLanguageInspection {
  readonly text: string;
  /** Which patient-facing surface this text is destined for. */
  readonly surface: GuardedSurface;
  /** BCP-47 tag of the text, e.g. "en" or "en-KE". */
  readonly locale: string;
}

export interface DiagnosisLanguageFinding {
  /** Stable pattern id. This is the only field safe to log (spec §18). */
  readonly patternId: string;
  readonly category: ProhibitedPatternCategory;
  /**
   * The offending span, taken from the normalized text.
   *
   * Patient-derived text. Spec §18 forbids raw symptom text in logs and telemetry — pass
   * this to a reviewer or a rewrite step, never to a log line.
   */
  readonly matchedText: string;
  /** Offset of the span in the normalized text. */
  readonly index: number;
}

/**
 * Whether the text was actually checked. Distinct from `allowed`, for the same reason
 * `SafetyAssessment.unknownReason` is distinct from `urgency`: "we checked and found
 * nothing" and "we could not check" must never be presented the same way.
 */
export type DiagnosisLanguageCoverage =
  /** Patterns exist for this locale and surface, and were run. */
  | "checked"
  /** No pattern set is registered for this locale. */
  | "unsupported_locale"
  /** The locale is registered but declares no pattern for this surface. */
  | "no_patterns_for_surface";

export interface DiagnosisLanguageVerdict {
  /** True only when the text was checked and nothing matched. Unchecked text is never allowed. */
  readonly allowed: boolean;
  readonly surface: GuardedSurface;
  /** The locale the caller declared. */
  readonly locale: string;
  /** The pattern-set locale that was actually used, when one was found. */
  readonly resolvedLocale?: string;
  readonly patternSetVersion?: string;
  readonly coverage: DiagnosisLanguageCoverage;
  readonly findings: readonly DiagnosisLanguageFinding[];
}

/**
 * Post-generation guard over patient-facing model output (spec §14).
 *
 * Synchronous by design. Every layer of it — normalization and regex matching over an
 * in-memory, version-pinned pattern set — is pure computation with no I/O, so there is
 * nothing for a Promise to represent. It also runs in the same synchronous safety path as
 * `SafetyEngine` (spec §8.7, "safety-critical execution is synchronous"); an async guard
 * would invite a caller to render text before the check resolved.
 */
export interface DiagnosisLanguageGuard {
  inspect(inspection: DiagnosisLanguageInspection): DiagnosisLanguageVerdict;
}

export interface DiagnosisLanguageGuardOptions {
  /** Pattern sets available for lookup. Defaults to those shipped with the package. */
  registry?: ProhibitedPatternRegistry;
}

/**
 * Folds away the ways the same sentence can be written without changing what it says:
 * smart quotes, non-breaking and zero-width characters, compatibility forms, and runs of
 * whitespace. Line breaks survive, because they bound a sentence for `near()`.
 */
export function normalizeForMatching(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201B\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

/**
 * Runs the prohibited-pattern layer over one piece of text.
 *
 * Deterministic: the same text, surface, locale and pattern-set version always produce
 * the same verdict, mirroring the requirement §8.6 puts on the rule engine.
 */
export function inspectDiagnosisLanguage(
  inspection: DiagnosisLanguageInspection,
  options: DiagnosisLanguageGuardOptions = {},
): DiagnosisLanguageVerdict {
  const registry = options.registry ?? defaultProhibitedPatternRegistry;
  const { surface, locale } = inspection;

  const set = registry.resolve(locale);
  if (!set) {
    // Fail closed. Text in a language nobody has written patterns for is unverifiable,
    // and spec §8.3.C's principle — never manufacture reassurance from an absence of
    // information — applies to the guard as much as to the engine.
    return {
      allowed: false,
      surface,
      locale,
      coverage: "unsupported_locale",
      findings: [],
    };
  }

  const patterns = registry.patternsFor(locale, surface);
  if (patterns.length === 0) {
    return {
      allowed: false,
      surface,
      locale,
      resolvedLocale: set.locale,
      patternSetVersion: set.version,
      coverage: "no_patterns_for_surface",
      findings: [],
    };
  }

  const normalized = normalizeForMatching(inspection.text);
  const findings: DiagnosisLanguageFinding[] = [];
  for (const pattern of patterns) {
    const match = pattern.pattern.exec(normalized);
    if (match) {
      findings.push({
        patternId: pattern.id,
        category: pattern.category,
        matchedText: match[0],
        index: match.index,
      });
    }
  }

  return {
    allowed: findings.length === 0,
    surface,
    locale,
    resolvedLocale: set.locale,
    patternSetVersion: set.version,
    coverage: "checked",
    findings,
  };
}

/** The shipped guard. Stateless; safe to share. */
export class DeterministicDiagnosisLanguageGuard implements DiagnosisLanguageGuard {
  readonly #options: DiagnosisLanguageGuardOptions;

  constructor(options: DiagnosisLanguageGuardOptions = {}) {
    this.#options = options;
  }

  inspect(inspection: DiagnosisLanguageInspection): DiagnosisLanguageVerdict {
    return inspectDiagnosisLanguage(inspection, this.#options);
  }
}
