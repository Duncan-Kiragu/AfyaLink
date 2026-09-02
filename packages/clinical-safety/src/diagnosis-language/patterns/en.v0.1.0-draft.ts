import {
  anyOf,
  defineLocalePatternSet,
  near,
  prohibitedPattern,
  words,
  type GuardedSurface,
  type ProhibitedPattern,
} from "../pattern-schema.js";

export const EN_PATTERNS_V0_1_0_DRAFT_VERSION = "en@0.1.0-draft";

/** Both surfaces this guard covers. Most diagnostic frames are prohibited on either. */
const BOTH: readonly GuardedSurface[] = ["urgency_explanation", "trend_statement"];
const URGENCY: readonly GuardedSurface[] = ["urgency_explanation"];
const TREND: readonly GuardedSurface[] = ["trend_statement"];

// ---------------------------------------------------------------------------
// Lexical fragments.
//
// These are the moving parts of a diagnostic sentence, not whole sentences. Composing
// patterns from them is what covers paraphrase and reordering: a rewritten sentence with
// the same frame trips the same pattern.
// ---------------------------------------------------------------------------

/** Epistemic hedges. "You may have", "you most likely have", "you seem to have". */
const HEDGE = anyOf(
  "probably",
  "most\\s+likely",
  "very\\s+likely",
  "quite\\s+likely",
  "almost\\s+certainly",
  "likely",
  "definitely",
  "certainly",
  "clearly",
  "apparently",
  "evidently",
  "possibly",
  "perhaps",
  "maybe",
  "may",
  "might",
  "could",
  "must",
  "seem\\s+to",
  "seems\\s+to",
  "appear\\s+to",
  "appears\\s+to",
);

/**
 * Ways of saying the patient is carrying a condition, without their subject or copula.
 * The copula and any hedges are absorbed by `SUBJECT_FILLER`, so "you are most likely
 * suffering from X" and "you have X" trip the same pattern.
 */
const HAS_CONDITION = anyOf(
  "have\\s+got",
  "have",
  "has",
  "had",
  "having",
  "got",
  "suffering\\s+from",
  "dealing\\s+with",
  "down\\s+with",
  "come\\s+down\\s+with",
  "battling",
);

/**
 * Words that may sit between "you" and the possession verb without changing the claim:
 * a hedge, a copula, or an intensifier. Repeatable, so hedges can stack.
 */
const SUBJECT_FILLER = `(?:(?:${HEDGE}|are|were|is|do|really|actually|still|now|clearly)\\s+)*`;

/**
 * Reporting frames that make "you have" factual rather than diagnostic.
 *
 * "Based on what you have reported…" is spec §8.3.D's own approved wording, so the
 * assertion pattern must not swallow it. This is the only exemption in the set, and it is
 * narrow on purpose: it covers verbs of *reporting*, never verbs of *being*.
 */
const REPORTING = anyOf(
  "reported",
  "told",
  "described",
  "mentioned",
  "said",
  "shared",
  "listed",
  "answered",
  "noted",
  "recorded",
  "given",
  "provided",
  "not\\s+reported",
  "been\\s+reporting",
  "been\\s+recording",
  "been\\s+asked",
  "been\\s+answering",
);

/** Permission to wait. A disposition prose must never issue (spec §8.3.A, §8.3.D). */
const DEFERRAL = anyOf(
  "you\\s+can\\s+wait",
  "it\\s+can\\s+wait",
  "this\\s+can\\s+wait",
  "can\\s+wait\\s+until",
  "safe\\s+to\\s+wait",
  "fine\\s+to\\s+wait",
  "wait\\s+(?:until|till|for)\\s+(?:tomorrow|the\\s+morning|a\\s+few\\s+days|next\\s+week)",
  "no\\s+need\\s+to\\s+(?:rush|hurry|worry|panic|be\\s+seen|see|visit)",
  "no\\s+(?:rush|hurry)",
  "there\\s+is\\s+no\\s+(?:rush|hurry|need)",
  "there's\\s+no\\s+(?:rush|hurry|need)",
  "not\\s+urgent",
  "nothing\\s+to\\s+worry\\s+about",
  "you\\s+(?:will|should)\\s+be\\s+fine",
  "you'll\\s+be\\s+fine",
  "it\\s+(?:will|'ll)\\s+pass",
  "see\\s+how\\s+it\\s+goes",
);

/** Nouns a trend statement legitimately talks about — and that a claim can attach to. */
const OBSERVATION_NOUN = anyOf(
  "patterns?",
  "trends?",
  "results?",
  "readings?",
  "scores?",
  "symptoms?",
  "findings?",
  "check-?ins?",
  "history",
  "data",
);

/** Verbs that turn an observation into a claim about a condition. */
const CLAIM_VERB = anyOf(
  "means?",
  "meaning",
  "indicates?",
  "confirms?",
  "proves?",
  "reveals?",
  "points?\\s+to",
  "tells?\\s+us",
);

const PATTERNS: readonly ProhibitedPattern[] = [
  {
    id: "en.diagnostic_assertion.you_have_condition",
    category: "diagnostic_assertion",
    surfaces: BOTH,
    // "You have X", "You may have X", "You are suffering from X", "You most likely have X".
    // The trailing lookahead spares reporting frames such as "what you have reported".
    pattern: prohibitedPattern(
      `\\byou\\b\\s+${SUBJECT_FILLER}${HAS_CONDITION}\\b(?!\\s+${REPORTING}\\b)`,
    ),
    rationale:
      "Spec §14 rejects 'You have…' / 'You may have…'. Constitution §1.1: never diagnose.",
  },
  {
    id: "en.diagnostic_assertion.hedged_possession",
    category: "diagnostic_assertion",
    surfaces: BOTH,
    // Subject-less variant, so a code-switched subject ("Wewe probably have X") or a
    // clause with the pronoun elided still trips.
    pattern: prohibitedPattern(
      words(
        anyOf("probably", "most\\s+likely", "almost\\s+certainly", "definitely"),
        anyOf("have\\s+got", "have", "has", "got"),
      ),
    ),
    rationale:
      "Spec §14 'You probably have…' with the subject dropped or in another language (§10.4.D code switching).",
  },
  {
    id: "en.diagnostic_speculation.resemblance",
    category: "diagnostic_speculation",
    surfaces: BOTH,
    pattern: prohibitedPattern(
      `\\b${anyOf(
        "sounds?\\s+like",
        "looks?\\s+like",
        "seems?\\s+like",
        "feels?\\s+like",
        "resembles?",
        "resembling",
        "reminds?\\s+me\\s+of",
      )}\\b`,
    ),
    rationale: "Spec §14 rejects 'This sounds like…'.",
  },
  {
    id: "en.diagnostic_speculation.inference",
    category: "diagnostic_speculation",
    surfaces: BOTH,
    pattern: prohibitedPattern(
      `\\b${anyOf(
        "suggests?",
        "suggesting",
        "suggestive\\s+of",
        "consistent\\s+with",
        "indicative\\s+of",
        "characteristic\\s+of",
        "typical\\s+of",
        "in\\s+keeping\\s+with",
        "points?\\s+(?:to|towards?)",
        "pointing\\s+(?:to|towards?)",
      )}\\b`,
    ),
    rationale: "Spec §14 rejects 'These symptoms suggest…'.",
  },
  {
    id: "en.diagnostic_speculation.hedged_identity",
    category: "diagnostic_speculation",
    surfaces: BOTH,
    // "This could be X", "This is likely X", "It appears to be X".
    // A bare copula is deliberately excluded so disclaimers survive: "This is not a
    // diagnosis" and "This is what you reported" must both pass.
    pattern: prohibitedPattern(
      words(
        `\\b${anyOf(
          "this",
          "that",
          "it",
          "the\\s+cause",
          "the\\s+problem",
          "your\\s+condition",
          "your\\s+illness",
        )}`,
        `${anyOf(
          "could\\s+be",
          "may\\s+be",
          "might\\s+be",
          "must\\s+be",
          "would\\s+be",
          "is\\s+(?:probably|likely|most\\s+likely|almost\\s+certainly|definitely|clearly)",
          "seems?\\s+to\\s+be",
          "appears?\\s+to\\s+be",
          "looks\\s+to\\s+be",
        )}\\b`,
      ),
    ),
    rationale: "Spec §14 rejects 'This is likely…' and 'This could be…'.",
  },
  {
    id: "en.diagnostic_label.named_construct",
    category: "diagnostic_label",
    surfaces: BOTH,
    // "possible diagnosis", "differential diagnosis", "top three diagnoses".
    // Bare "diagnose" is not matched, so "KKD does not diagnose" stays sayable.
    pattern: prohibitedPattern(
      `\\b${anyOf(
        "possible",
        "probable",
        "likely",
        "working",
        "provisional",
        "presumptive",
        "differential",
        "top",
      )}\\s+(?:\\w+\\s+){0,2}diagnos(?:is|es)\\b`,
    ),
    rationale: "Spec §14 rejects 'Possible diagnosis…' / 'Differential diagnosis…'.",
  },
  {
    id: "en.diagnostic_label.diagnosis_is",
    category: "diagnostic_label",
    surfaces: BOTH,
    pattern: prohibitedPattern(
      words(
        "\\bdiagnos(?:is|es)",
        `${anyOf("is", "are", "would\\s+be", "could\\s+be", "might\\s+be")}\\b`,
      ),
    ),
    rationale:
      "Spec §14; naming a diagnosis is prohibited however the sentence is framed.",
  },
  {
    id: "en.likelihood_statement.probability_noun",
    category: "likelihood_statement",
    surfaces: BOTH,
    // Deliberately blunt: on these two surfaces KKD never states a probability at all, so
    // no object or connector is required. That is what catches §8.4.D's named example
    // ("Your likelihood of X is increasing") and its code-switched paraphrases, where the
    // connector after the noun may not be English.
    pattern: prohibitedPattern(
      `\\b${anyOf("likelihood", "probability", "probabilities", "chances?", "odds")}\\b`,
    ),
    rationale:
      "Spec §8.4.D prohibits 'Your likelihood of X is increasing'; §8.7 requires trends to be factual.",
  },
  {
    id: "en.likelihood_statement.risk_of",
    category: "likelihood_statement",
    surfaces: BOTH,
    pattern: prohibitedPattern(words("\\brisks?", `${anyOf("of", "that", "for")}\\b`)),
    rationale: "Spec §8.4.D; a stated risk of a condition is a probability claim.",
  },
  {
    id: "en.likelihood_statement.comparative",
    category: "likelihood_statement",
    surfaces: BOTH,
    // The same claim without the noun: "increasingly likely", "more likely to be X".
    pattern: prohibitedPattern(
      words(
        `\\b${anyOf("more", "less", "increasingly", "progressively", "steadily", "growing")}`,
        "likely\\b",
      ),
    ),
    rationale: "Spec §8.4.D; a moving probability is prohibited however it is phrased.",
  },
  {
    id: "en.likelihood_statement.observation_implies_condition",
    category: "likelihood_statement",
    surfaces: TREND,
    // Spec §8.4.D's other named prohibition: "This pattern means you have malaria."
    // Matching noun-near-verb rather than the whole sentence covers "these results
    // indicate…", "the trend points to…", "your check-in history confirms…".
    pattern: prohibitedPattern(
      near([`\\b${OBSERVATION_NOUN}\\b`, `\\b${CLAIM_VERB}\\b`], 20),
    ),
    rationale:
      "Spec §8.4.D prohibits 'This pattern means you have malaria'; §8.7 'trends are factual and non-diagnostic'.",
  },
  {
    id: "en.prognostic_forecast.you_will_develop",
    category: "prognostic_forecast",
    surfaces: TREND,
    pattern: prohibitedPattern(
      words(
        "\\byou\\b",
        anyOf("will", "'ll", "are\\s+going\\s+to", "may", "might", "could"),
        `${anyOf("develop", "get", "catch", "come\\s+down\\s+with", "end\\s+up\\s+with", "progress\\s+to")}\\b`,
      ),
    ),
    rationale:
      "Spec §8.4.D; a trend statement reports what was recorded, it does not forecast a course.",
  },
  {
    id: "en.unapproved_deferral.permission_to_wait",
    category: "unapproved_deferral",
    surfaces: URGENCY,
    pattern: prohibitedPattern(`\\b${DEFERRAL}`),
    rationale:
      "Spec §8.3.A: the rule engine owns the disposition. §8.3.C: never create false reassurance.",
  },
  {
    id: "en.unapproved_deferral.diagnosis_led",
    category: "unapproved_deferral",
    surfaces: URGENCY,
    // Spec §8.3.D's named example, as a shape rather than a string: a claim about what the
    // patient has, joined in one sentence to permission to wait. Reported separately from
    // its two halves because it is the composite the spec calls out by hand.
    pattern: prohibitedPattern(
      near(
        [
          `\\byou\\b\\s+${SUBJECT_FILLER}${HAS_CONDITION}\\b(?!\\s+${REPORTING}\\b)`,
          `\\b${DEFERRAL}`,
        ],
        60,
      ),
    ),
    rationale: 'Spec §8.3.D: never say "You probably have X, so you can wait."',
  },
];

export const enPatternsV0_1_0Draft = defineLocalePatternSet(
  "en",
  EN_PATTERNS_V0_1_0_DRAFT_VERSION,
  PATTERNS,
);
