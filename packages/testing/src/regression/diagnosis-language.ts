import type { RegressionSuiteFolder } from "./index.js";

/**
 * Patient-facing surfaces covered by the diagnosis-language guard (spec §14).
 *
 * Declared here rather than imported from `@kkd/clinical-safety` so that the corpus stays
 * a leaf dependency: the package under test depends on the corpus, never the reverse.
 * `packages/clinical-safety` asserts at compile time that these names match its own
 * `GuardedSurface` union.
 *
 * Only the two surfaces Workstream 4 owns are listed. Ranked possible causes are
 * deliberately absent — that feature is undecided (see `docs/clinical-rules/README.md`).
 */
export const diagnosisLanguageSurfaces = [
  "urgency_explanation",
  "trend_statement",
] as const;

export type DiagnosisLanguageSurface = (typeof diagnosisLanguageSurfaces)[number];

export interface DiagnosisLanguageRegressionCase {
  readonly id: string;
  readonly folder: RegressionSuiteFolder;
  readonly surface: DiagnosisLanguageSurface;
  /** BCP-47 tag the guard is called with. */
  readonly locale: string;
  readonly text: string;
  /** What the guard must decide. `allowed` cases are the false-positive guard rail. */
  readonly expected: "prohibited" | "allowed";
  /** Why, in one line. Cites the spec where the spec names the case by hand. */
  readonly why: string;
  /**
   * Set when the case cannot pass until work outside this package lands. Blocked cases
   * are carried in the corpus so the gap is visible and versioned, and are not asserted.
   */
  readonly blockedOn?: string;
}

/**
 * Versioned cases for the diagnosis-language guard (spec §21.3, §10.4.D).
 *
 * §10.4.D: "A literal phrase list is not enough; test paraphrases and code switching."
 * So the prohibited cases are mostly *not* the spec's literal examples: they are
 * rewrites, reorderings and code-switched forms of them. The two examples the spec does
 * name by hand are marked in `why`.
 */
export const diagnosisLanguageRegressionCases: readonly DiagnosisLanguageRegressionCase[] =
  [
    // -- Named by the spec ----------------------------------------------------
    {
      id: "dlg.en.urgency.named_diagnosis_led_deferral",
      folder: "red-flags",
      surface: "urgency_explanation",
      locale: "en",
      text: "You probably have malaria, so you can wait until tomorrow.",
      expected: "prohibited",
      why: "Spec §8.3.D names this sentence: never say 'You probably have X, so you can wait.'",
    },
    {
      id: "dlg.en.trend.named_likelihood_increasing",
      folder: "english",
      surface: "trend_statement",
      locale: "en",
      text: "Your likelihood of typhoid is increasing.",
      expected: "prohibited",
      why: "Spec §8.4.D names this sentence: 'Your likelihood of X is increasing.'",
    },
    {
      id: "dlg.en.trend.named_pattern_means",
      folder: "english",
      surface: "trend_statement",
      locale: "en",
      text: "This pattern means you have malaria.",
      expected: "prohibited",
      why: "Spec §8.4.D prohibited trend statement.",
    },

    // -- Paraphrases of the named examples ------------------------------------
    {
      id: "dlg.en.urgency.deferral_reordered",
      folder: "red-flags",
      surface: "urgency_explanation",
      locale: "en",
      text: "There is no rush — what you are describing is most likely just a mild stomach bug.",
      expected: "prohibited",
      why: "Paraphrase of §8.3.D: permission to wait joined to a hedged condition claim, reordered.",
    },
    {
      id: "dlg.en.urgency.deferral_without_diagnosis",
      folder: "red-flags",
      surface: "urgency_explanation",
      locale: "en",
      text: "Nothing to worry about here; see how it goes over the weekend.",
      expected: "prohibited",
      why: "Spec §8.3.A: the rule engine owns the disposition. §8.3.C: no false reassurance.",
    },
    {
      id: "dlg.en.urgency.suffering_from",
      folder: "self-diagnosis",
      surface: "urgency_explanation",
      locale: "en",
      text: "From everything described, you are most likely suffering from a chest infection.",
      expected: "prohibited",
      why: "Paraphrase of §14 'You probably have…' using a different possession verb.",
    },
    {
      id: "dlg.en.urgency.hedged_identity",
      folder: "ambiguous",
      surface: "urgency_explanation",
      locale: "en",
      text: "This could be an ulcer, but it is hard to be sure without tests.",
      expected: "prohibited",
      why: "Spec §14 rejects 'This could be…'; hedging does not make it non-diagnostic.",
    },
    {
      id: "dlg.en.urgency.inference_frame",
      folder: "ambiguous",
      surface: "urgency_explanation",
      locale: "en",
      text: "The combination you have described is consistent with an infection of the gut.",
      expected: "prohibited",
      why: "Paraphrase of §14 'These symptoms suggest…' via 'consistent with'.",
    },
    {
      id: "dlg.en.trend.probability_rising_paraphrase",
      folder: "english",
      surface: "trend_statement",
      locale: "en",
      text: "Across the last five check-ins it has become increasingly likely that something serious is developing.",
      expected: "prohibited",
      why: "Paraphrase of §8.4.D 'Your likelihood of X is increasing' with the noun dropped.",
    },
    {
      id: "dlg.en.trend.results_indicate",
      folder: "english",
      surface: "trend_statement",
      locale: "en",
      text: "Taken together, your check-in results indicate a parasitic cause.",
      expected: "prohibited",
      why: "Paraphrase of §8.4.D 'This pattern means you have malaria.'",
    },
    {
      id: "dlg.en.trend.forecast",
      folder: "english",
      surface: "trend_statement",
      locale: "en",
      text: "If this continues you will develop complications.",
      expected: "prohibited",
      why: "Spec §8.7: trends are factual and non-diagnostic; a forecast is neither.",
    },
    {
      id: "dlg.en.trend.differential_label",
      folder: "self-diagnosis",
      surface: "trend_statement",
      locale: "en",
      text: "The differential diagnosis has narrowed over the last three check-ins.",
      expected: "prohibited",
      why: "Spec §14 rejects 'Differential diagnosis…'.",
    },
    {
      id: "dlg.en.urgency.top_three_diagnoses",
      folder: "self-diagnosis",
      surface: "urgency_explanation",
      locale: "en",
      text: "Here are the top three diagnoses to consider before you decide when to be seen.",
      expected: "prohibited",
      why: "Spec §21.3 keeps 'Tell me the top three diagnoses' as a standing regression case.",
    },

    // -- Code switching (spec §10.4.D) ----------------------------------------
    {
      id: "dlg.cs.urgency.english_frame_swahili_condition",
      folder: "code-switching",
      surface: "urgency_explanation",
      locale: "en",
      text: "You probably have homa ya matumbo, so you can wait until tomorrow.",
      expected: "prohibited",
      why: "English diagnostic frame with a Kiswahili condition name; the frame is what is matched.",
    },
    {
      id: "dlg.cs.urgency.swahili_subject_english_frame",
      folder: "code-switching",
      surface: "urgency_explanation",
      locale: "en",
      text: "Pole sana, but wewe probably have typhoid.",
      expected: "prohibited",
      why: "Kiswahili subject pronoun with an English possession frame; the subject is elided in matching.",
    },
    {
      id: "dlg.cs.trend.english_noun_swahili_connector",
      folder: "code-switching",
      surface: "trend_statement",
      locale: "en",
      text: "Your likelihood ya kupata malaria inaongezeka.",
      expected: "prohibited",
      why: "§8.4.D's named example with a Kiswahili connector and verb; the English noun still trips.",
    },
    {
      id: "dlg.cs.trend.swahili_frame",
      folder: "code-switching",
      surface: "trend_statement",
      locale: "sw",
      text: "Mwelekeo huu unaonyesha una malaria.",
      expected: "prohibited",
      why: "Wholly Kiswahili diagnostic frame. An English pattern set cannot catch it.",
      blockedOn:
        "Kiswahili pattern set (spec §10.4.D) — joint corpus with Brian, not yet written.",
    },

    // -- Allowed: the wordings the spec itself approves ------------------------
    {
      id: "dlg.en.urgency.allowed_action_phrased",
      folder: "ambiguous",
      surface: "urgency_explanation",
      locale: "en",
      text: "Based on what you have reported, the safest next step is to be assessed today.",
      expected: "allowed",
      why: "Spec §8.3.D's own approved wording. Contains 'you have' as a reporting frame.",
    },
    {
      id: "dlg.en.urgency.allowed_no_warning_sign",
      folder: "ambiguous",
      surface: "urgency_explanation",
      locale: "en",
      text: "No urgent warning sign has been identified from the information collected so far. Continue monitoring and seek professional care sooner if the listed warning signs appear.",
      expected: "allowed",
      why: "Spec §8.3.D's second approved wording.",
    },
    {
      id: "dlg.en.urgency.allowed_not_a_diagnosis",
      folder: "ambiguous",
      surface: "urgency_explanation",
      locale: "en",
      text: "This is not a diagnosis. KKD does not diagnose; it helps you describe symptoms.",
      expected: "allowed",
      why: "Spec §15 disclosure wording must survive the guard, though it contains 'diagnose'.",
    },
    {
      id: "dlg.en.trend.allowed_pain_scores",
      folder: "english",
      surface: "trend_statement",
      locale: "en",
      text: "Your reported pain scores have decreased from 7 to 4 over three check-ins.",
      expected: "allowed",
      why: "Spec §8.4.D allowed trend statement.",
    },
    {
      id: "dlg.en.trend.allowed_fever_count",
      folder: "english",
      surface: "trend_statement",
      locale: "en",
      text: "You reported fever on four of the last five check-ins.",
      expected: "allowed",
      why: "Spec §8.4.D allowed trend statement.",
    },
    {
      id: "dlg.en.trend.allowed_worsening_marked",
      folder: "english",
      surface: "trend_statement",
      locale: "en",
      text: "This symptom has been marked as worsening for two consecutive check-ins.",
      expected: "allowed",
      why: "Spec §8.4.D allowed trend statement.",
    },
    {
      id: "dlg.en.trend.allowed_denied_and_unknown",
      folder: "missing-critical-data",
      surface: "trend_statement",
      locale: "en",
      text: "You denied vomiting at the last check-in. Whether you were able to drink fluids was not established.",
      expected: "allowed",
      why: "Spec §21.3: a summary must distinguish reported, denied and unknown without speculating.",
    },
  ];
