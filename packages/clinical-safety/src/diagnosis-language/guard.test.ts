import { diagnosisLanguageSurfaces } from "@kkd/testing";
import { describe, expect, it } from "vitest";
import {
  DeterministicDiagnosisLanguageGuard,
  inspectDiagnosisLanguage,
  normalizeForMatching,
} from "./guard.js";
import {
  anyOf,
  defineLocalePatternSet,
  GUARDED_SURFACES,
  near,
  prohibitedPattern,
  prohibitedPatternSchema,
  words,
  type GuardedSurface,
  type ProhibitedPattern,
} from "./pattern-schema.js";
import { enPatternsV0_1_0Draft } from "./patterns/en.v0.1.0-draft.js";
import {
  defaultProhibitedPatternRegistry,
  ProhibitedPatternRegistry,
} from "./registry.js";

function inspect(text: string, surface: GuardedSurface, locale = "en") {
  return inspectDiagnosisLanguage({ text, surface, locale });
}

function urgency(text: string) {
  return inspect(text, "urgency_explanation");
}

function trend(text: string) {
  return inspect(text, "trend_statement");
}

/**
 * Spec §8.3.D and §8.4.D each name one sentence by hand. Those two are the acceptance
 * criteria for this slice, so they get their own test rather than living only in the
 * corpus.
 */
describe("the two sentences the spec names by hand", () => {
  it("catches §8.3.D's 'You probably have X, so you can wait'", () => {
    const verdict = urgency("You probably have malaria, so you can wait.");

    expect(verdict.allowed).toBe(false);
    expect(verdict.findings.map((finding) => finding.patternId)).toContain(
      "en.unapproved_deferral.diagnosis_led",
    );
  });

  it("catches §8.4.D's 'Your likelihood of X is increasing'", () => {
    const verdict = trend("Your likelihood of malaria is increasing.");

    expect(verdict.allowed).toBe(false);
    expect(verdict.findings.map((finding) => finding.category)).toContain(
      "likelihood_statement",
    );
  });
});

/**
 * Spec §10.4.D: "A literal phrase list is not enough; test paraphrases and code
 * switching." None of these sentences appears in any pattern.
 */
describe("paraphrase", () => {
  it.each([
    "You are most likely suffering from a chest infection.",
    "You have got some kind of stomach bug.",
    "What you describe sounds like an ulcer.",
    "The picture you describe is consistent with an infection.",
    "Everything here points towards a viral cause.",
    "This could be something in the gut.",
    "It appears to be a reaction to the medication.",
    "The most probable working diagnosis is dehydration.",
  ])("rejects diagnostic speculation: %s", (text) => {
    expect(urgency(text).allowed).toBe(false);
  });

  it.each([
    "Your likelihood of dehydration is going up.",
    "The probability of a serious cause has risen.",
    "It is becoming increasingly likely that this is bacterial.",
    "There is a growing risk of a parasitic cause.",
    "These results indicate a bacterial cause.",
    "The trend confirms an infection.",
    "If this continues you will develop complications.",
  ])("rejects probability and inference in trends: %s", (text) => {
    expect(trend(text).allowed).toBe(false);
  });

  it.each([
    "There is no rush, this is most likely just a mild bug.",
    "Nothing to worry about — see how it goes.",
    "You'll be fine, it can wait until tomorrow.",
    "No need to rush to hospital for this one.",
  ])("rejects an unapproved deferral: %s", (text) => {
    expect(urgency(text).allowed).toBe(false);
  });
});

/**
 * Spec §10.4.D, code switching. Patterns match the diagnostic *frame*, so the condition
 * name, the subject, or the trailing verb can be in another language and the sentence is
 * still caught — as long as the frame itself is English.
 */
describe("code switching", () => {
  it("catches an English frame carrying a Kiswahili condition name", () => {
    expect(urgency("You probably have homa ya matumbo, so you can wait.").allowed).toBe(
      false,
    );
  });

  it("catches an English frame under a Kiswahili subject", () => {
    expect(urgency("Pole sana, but wewe probably have typhoid.").allowed).toBe(false);
  });

  it("catches an English probability noun with a Kiswahili predicate", () => {
    expect(trend("Your likelihood ya kupata malaria inaongezeka.").allowed).toBe(false);
  });

  it("refuses a wholly Kiswahili sentence rather than passing it", () => {
    // The `en` set cannot read this. Spec §10.4.D's Kiswahili corpus is Brian's and does
    // not exist yet, so the guard must not claim the sentence is clean.
    const verdict = inspect(
      "Mwelekeo huu unaonyesha una malaria.",
      "trend_statement",
      "sw",
    );

    expect(verdict.allowed).toBe(false);
    expect(verdict.coverage).toBe("unsupported_locale");
  });
});

/**
 * The false-positive rail. Every wording the spec itself approves must survive the guard,
 * or the guard is unusable and will be turned off.
 */
describe("wordings the spec approves", () => {
  it.each([
    "Based on what you have reported, the safest next step is to be assessed today.",
    "No urgent warning sign has been identified from the information collected so far. Continue monitoring and seek professional care sooner if the listed warning signs appear.",
    "This is not a diagnosis. KKD does not diagnose; it helps you describe symptoms.",
    "You have not reported any bleeding.",
    "You have been answering questions about chest pain.",
  ])("allows an urgency explanation: %s", (text) => {
    expect(urgency(text).findings).toEqual([]);
  });

  it.each([
    "Your reported pain scores have decreased from 7 to 4 over three check-ins.",
    "You reported fever on four of the last five check-ins.",
    "This symptom has been marked as worsening for two consecutive check-ins.",
    "You denied vomiting at the last check-in.",
  ])("allows a trend statement: %s", (text) => {
    expect(trend(text).findings).toEqual([]);
  });
});

describe("surface scoping", () => {
  it("applies deferral patterns to urgency explanations only", () => {
    const text = "There is no rush; you can wait until tomorrow.";

    expect(urgency(text).allowed).toBe(false);
    expect(trend(text).allowed).toBe(true);
  });

  it("applies trend-specific patterns to trend statements only", () => {
    const text = "The pattern means something is developing.";

    expect(trend(text).allowed).toBe(false);
    expect(urgency(text).allowed).toBe(true);
  });

  it("applies core diagnostic patterns to both surfaces", () => {
    const text = "You probably have an ulcer.";

    expect(urgency(text).allowed).toBe(false);
    expect(trend(text).allowed).toBe(false);
  });

  it("shares its surface vocabulary with the regression corpus", () => {
    // Also a compile-time check: the corpus declares these names independently, because
    // it must stay a leaf dependency.
    const corpusSurfaces: readonly GuardedSurface[] = diagnosisLanguageSurfaces;

    expect([...corpusSurfaces].sort()).toEqual([...GUARDED_SURFACES].sort());
  });

  it("covers every declared surface with at least one pattern", () => {
    for (const surface of GUARDED_SURFACES) {
      expect(
        defaultProhibitedPatternRegistry.patternsFor("en", surface).length,
      ).toBeGreaterThan(0);
    }
  });
});

describe("coverage is reported separately from the verdict", () => {
  it("fails closed on an unregistered locale", () => {
    const verdict = inspect("You probably have malaria.", "urgency_explanation", "fr");

    expect(verdict.allowed).toBe(false);
    expect(verdict.coverage).toBe("unsupported_locale");
    expect(verdict.findings).toEqual([]);
  });

  it("fails closed when the locale declares no pattern for the surface", () => {
    const partial = defineLocalePatternSet("en", "en@test", [
      {
        id: "en.diagnostic_assertion.test_only",
        category: "diagnostic_assertion",
        surfaces: ["trend_statement"],
        pattern: prohibitedPattern("\\byou have\\b"),
        rationale: "test",
      },
    ]);
    const registry = new ProhibitedPatternRegistry([partial]);

    const verdict = inspectDiagnosisLanguage(
      { text: "anything", surface: "urgency_explanation", locale: "en" },
      { registry },
    );

    expect(verdict.allowed).toBe(false);
    expect(verdict.coverage).toBe("no_patterns_for_surface");
  });

  it("reports 'checked' when patterns ran and nothing matched", () => {
    const verdict = trend("You reported fever on four of the last five check-ins.");

    expect(verdict.coverage).toBe("checked");
    expect(verdict.allowed).toBe(true);
    expect(verdict.patternSetVersion).toBe(enPatternsV0_1_0Draft.version);
  });

  it("resolves a region tag to its primary subtag", () => {
    const verdict = inspect("You probably have malaria.", "urgency_explanation", "en-KE");

    expect(verdict.resolvedLocale).toBe("en");
    expect(verdict.allowed).toBe(false);
  });
});

describe("normalization", () => {
  it("folds smart quotes so an evasion by typography does not pass", () => {
    expect(urgency("You’ll be fine, no need to worry.").allowed).toBe(false);
  });

  it("folds runs of whitespace but keeps line breaks as sentence boundaries", () => {
    expect(normalizeForMatching("a  \t b\r\nc")).toBe("a b\nc");
  });

  it("does not join a claim across a line break", () => {
    // `near()` matches within a sentence. A pattern noun on one line and a claim verb on
    // the next are two statements, not one.
    expect(trend("Your scores\nmean nothing has changed.").allowed).toBe(true);
  });
});

describe("determinism", () => {
  it("returns the same verdict for the same input", () => {
    const guard = new DeterministicDiagnosisLanguageGuard();
    const request = {
      text: "You probably have malaria, so you can wait.",
      surface: "urgency_explanation",
      locale: "en",
    } as const;

    expect(guard.inspect(request)).toEqual(guard.inspect(request));
  });

  it("rejects a stateful pattern, whose lastIndex would leak between calls", () => {
    expect(() =>
      prohibitedPatternSchema.parse({
        id: "en.diagnostic_assertion.stateful",
        category: "diagnostic_assertion",
        surfaces: ["trend_statement"],
        pattern: /\byou have\b/gi,
        rationale: "test",
      }),
    ).toThrow();
  });
});

describe("pattern sets are validated at load", () => {
  const valid: ProhibitedPattern = {
    id: "xx.diagnostic_assertion.example",
    category: "diagnostic_assertion",
    surfaces: ["trend_statement"],
    pattern: prohibitedPattern("\\bexample\\b"),
    rationale: "test",
  };

  it("rejects a pattern id belonging to another locale", () => {
    expect(() => defineLocalePatternSet("yy", "yy@test", [valid])).toThrow(
      /does not belong to locale/,
    );
  });

  it("rejects a duplicate pattern id", () => {
    expect(() => defineLocalePatternSet("xx", "xx@test", [valid, valid])).toThrow(
      /Duplicate/,
    );
  });

  it("rejects a case-sensitive pattern", () => {
    expect(() =>
      defineLocalePatternSet("xx", "xx@test", [{ ...valid, pattern: /example/ }]),
    ).toThrow();
  });

  it("refuses to register the same locale twice", () => {
    const registry = new ProhibitedPatternRegistry([enPatternsV0_1_0Draft]);

    expect(() => registry.register(enPatternsV0_1_0Draft)).toThrow(/already registered/);
  });

  it("ships English only", () => {
    expect(defaultProhibitedPatternRegistry.locales()).toEqual(["en"]);
  });
});

/**
 * A second locale must be a data addition. This builds one from the same helpers the
 * English file uses, with no change to the guard, the registry or the schema.
 */
describe("adding a locale is a data addition", () => {
  it("registers and enforces a new locale built only from the shared helpers", () => {
    const swahiliish = defineLocalePatternSet("sw", "sw@test", [
      {
        id: "sw.diagnostic_assertion.una_ugonjwa",
        category: "diagnostic_assertion",
        surfaces: ["urgency_explanation", "trend_statement"],
        pattern: prohibitedPattern(words("\\buna", anyOf("ugonjwa", "malaria") + "\\b")),
        rationale: "Spec §10.4.D placeholder for the Kiswahili corpus.",
      },
      {
        id: "sw.unapproved_deferral.subiri",
        category: "unapproved_deferral",
        surfaces: ["urgency_explanation"],
        pattern: prohibitedPattern(near(["\\bunaweza\\b", "\\bsubiri\\b"], 30)),
        rationale: "Spec §10.4.D placeholder for the Kiswahili corpus.",
      },
    ]);
    const registry = new ProhibitedPatternRegistry([enPatternsV0_1_0Draft, swahiliish]);

    expect(
      inspectDiagnosisLanguage(
        { text: "Una malaria.", surface: "trend_statement", locale: "sw" },
        { registry },
      ).allowed,
    ).toBe(false);
    expect(
      inspectDiagnosisLanguage(
        {
          text: "Unaweza subiri mpaka kesho.",
          surface: "urgency_explanation",
          locale: "sw",
        },
        { registry },
      ).allowed,
    ).toBe(false);
    // English is unaffected by the addition.
    expect(
      inspectDiagnosisLanguage(
        {
          text: "You reported fever on four of the last five check-ins.",
          surface: "trend_statement",
          locale: "en",
        },
        { registry },
      ).allowed,
    ).toBe(true);
  });
});
