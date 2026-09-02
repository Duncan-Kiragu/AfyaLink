import { z } from "zod";

/**
 * The patient-facing surfaces this guard is authorised to check (spec §14).
 *
 * Deliberately **two** members, not a general "any model output" string:
 *
 * - `urgency_explanation` — the text that explains a disposition to a patient
 *   (spec §8.3.D, "Can I wait until tomorrow?" behaviour);
 * - `trend_statement` — the factual sentence describing check-in history
 *   (spec §8.4.D, "trends are factual and non-diagnostic" per §8.7).
 *
 * These are the two surfaces Workstream 4 owns and can specify. Other surfaces named by
 * §14 (web, summary, WhatsApp, USSD free text, voice scripts, MCP outputs, exported
 * documents) are **not** covered here — see `docs/clinical-rules/README.md`.
 *
 * Adding a surface is deliberately a two-part act: a new member here *and* new
 * `ProhibitedPattern` entries that name it. A pattern only ever applies to the surfaces
 * it lists, so a surface added later cannot silently change what the two existing
 * surfaces accept or reject, and a surface with no patterns of its own fails closed
 * rather than inheriting someone else's.
 */
export const GUARDED_SURFACES = ["urgency_explanation", "trend_statement"] as const;

export const guardedSurfaceSchema = z.enum(GUARDED_SURFACES);
export type GuardedSurface = z.infer<typeof guardedSurfaceSchema>;

/**
 * Why a span is prohibited. Reported per finding so a caller (and a reviewer) can see
 * which clause of the constitution the text tripped, not merely that it failed.
 */
export const prohibitedPatternCategorySchema = z.enum([
  /** States that the patient has a condition. Constitution §1.1, "Never diagnose". */
  "diagnostic_assertion",
  /** Hedges towards a condition. Constitution §1.1, "Never speculate diagnostically". */
  "diagnostic_speculation",
  /** Names a diagnostic construct at all ("possible diagnosis", "differential"). */
  "diagnostic_label",
  /** Puts a probability on a condition, static or moving (spec §8.4.D). */
  "likelihood_statement",
  /** Tells the patient it is safe to wait — a disposition prose must never issue (§8.3.D). */
  "unapproved_deferral",
  /** Predicts a future clinical course (spec §8.4.D, §8.7 "trends are factual"). */
  "prognostic_forecast",
]);
export type ProhibitedPatternCategory = z.infer<typeof prohibitedPatternCategorySchema>;

/**
 * One prohibited semantic pattern, in one locale.
 *
 * Patterns match a *frame* ("you probably have …", "the likelihood of …"), never a list
 * of disease names. Spec §10.4.D: "A literal phrase list is not enough; test paraphrases
 * and code switching." Matching the frame is what makes paraphrase and code-switching
 * tractable: the condition word can be in any language, or a word nobody has heard of,
 * and the sentence is still caught.
 */
export interface ProhibitedPattern {
  /** `<locale>.<category>.<name>`, e.g. `en.diagnostic_speculation.resemblance`. */
  readonly id: string;
  readonly category: ProhibitedPatternCategory;
  /** The surfaces this pattern applies to. A pattern never applies to a surface it omits. */
  readonly surfaces: readonly GuardedSurface[];
  readonly pattern: RegExp;
  /** Why this is prohibited, citing the spec. Read by reviewers, not by patients. */
  readonly rationale: string;
}

export const PROHIBITED_PATTERN_ID =
  /^[a-z]{2,3}(?:-[a-z]{2,4})?\.[a-z0-9_]+(\.[a-z0-9_]+)+$/i;

export const prohibitedPatternSchema = z.object({
  id: z.string().regex(PROHIBITED_PATTERN_ID),
  category: prohibitedPatternCategorySchema,
  surfaces: z.array(guardedSurfaceSchema).min(1),
  pattern: z
    .instanceof(RegExp)
    // `g`/`y` regexes carry `lastIndex` between calls, which would make the guard
    // non-deterministic across invocations. `i` is required so a locale file never has
    // to spell out casing.
    .refine((value) => !value.global && !value.sticky, {
      message: "Prohibited patterns must not use the g or y flag",
    })
    .refine((value) => value.ignoreCase, {
      message: "Prohibited patterns must use the i flag",
    }),
  rationale: z.string().min(1),
});

/**
 * All prohibited patterns for one locale.
 *
 * There is **no clinical-review gate here**, unlike `SafetyRule` and `ComplaintPathway`.
 * A rule decides what a patient is told to do, so an unreviewed one must not run. This
 * guard only ever *refuses* text; running an unreviewed pattern set can over-block, never
 * under-block, so gating it behind review would make the conservative behaviour the
 * opt-in. Linguistic review still matters, and is tracked per version.
 */
export interface LocalePatternSet {
  /** BCP-47 primary subtag, or a full tag for a region-specific set. */
  readonly locale: string;
  readonly version: string;
  readonly patterns: readonly ProhibitedPattern[];
}

/**
 * Validates a locale pattern set at module load. A malformed pattern, a duplicate id, a
 * stateful regex or an id that does not belong to this locale is a load-time failure,
 * never a silent runtime skip.
 */
export function defineLocalePatternSet(
  locale: string,
  version: string,
  patterns: readonly ProhibitedPattern[],
): LocalePatternSet {
  const parsed = patterns.map((pattern) => {
    prohibitedPatternSchema.parse(pattern);
    return pattern;
  });

  const seen = new Set<string>();
  for (const pattern of parsed) {
    if (seen.has(pattern.id)) {
      throw new Error(`Duplicate prohibited pattern id "${pattern.id}" in ${locale}`);
    }
    seen.add(pattern.id);
    if (!pattern.id.startsWith(`${locale}.`)) {
      throw new Error(
        `Prohibited pattern "${pattern.id}" does not belong to locale ${locale}`,
      );
    }
  }

  return Object.freeze({ locale, version, patterns: Object.freeze(parsed) });
}

// ---------------------------------------------------------------------------
// Fragment helpers for locale files.
//
// A locale file composes patterns from these; it never needs to touch guard code. That
// is what makes a second locale a data addition (spec §10.4.D, Brian's corpus).
// ---------------------------------------------------------------------------

/** Characters a match may span without leaving the sentence. */
const WITHIN_SENTENCE = "[^.!?;\\n]";

/** Alternation group: `anyOf("a", "b")` -> `(?:a|b)`. */
export function anyOf(...alternatives: readonly string[]): string {
  return `(?:${alternatives.join("|")})`;
}

/** Fragments in order, separated by whitespace. */
export function words(...fragments: readonly string[]): string {
  return fragments.join("\\s+");
}

/**
 * Fragments in order within one sentence, tolerating up to `maxGap` characters between
 * them. This is how a pattern survives paraphrase: "you probably have X, so you can wait"
 * and "you have probably got some kind of X and it can wait" trip the same pattern.
 */
export function near(fragments: readonly string[], maxGap = 40): string {
  return fragments.join(`${WITHIN_SENTENCE}{0,${maxGap}}`);
}

/** Compiles a composed source string into a case-insensitive, stateless pattern. */
export function prohibitedPattern(source: string): RegExp {
  return new RegExp(source, "i");
}
