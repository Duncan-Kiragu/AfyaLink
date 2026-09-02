import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  missingKeys,
  resolveLocale,
  resources,
  safetyCriticalKeys,
  supportedLocales,
  t,
} from "./index.js";
import { USSD_MAX_BODY_CHARS } from "@kkd/contracts";
import en from "./locales/en.json" with { type: "json" };

const ALL_KEYS = Object.keys(en);

describe("locale catalogues", () => {
  it.each(supportedLocales)("%s defines every key the default locale defines", (locale) => {
    expect(missingKeys(locale)).toEqual([]);
  });

  it.each(supportedLocales)("%s has a non-empty value for every safety-critical key", (locale) => {
    for (const key of safetyCriticalKeys) {
      const value = t(locale, key);
      expect(value, `${locale}:${key}`).not.toBe(key);
      expect(value.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
    }
  });

  it("keeps English and Kiswahili keys aligned", () => {
    const enKeys = Object.keys(resources.en.translation).sort();
    const swKeys = Object.keys(resources.sw.translation).sort();
    expect(swKeys).toEqual(enKeys);
  });
});

describe("USSD safety strings fit a single screen", () => {
  const ussdSafetyKeys = [
    "channel.safety.ussd.emergency",
    "channel.safety.ussd.urgentToday",
    "channel.safety.ussd.soon",
    "channel.safety.ussd.monitor",
    "channel.safety.ussd.unknown",
    "channel.safety.ussd.unavailable",
    "channel.disclosure.ussd",
  ] as const;

  it.each(
    supportedLocales.flatMap((locale) => ussdSafetyKeys.map((key) => ({ locale, key }))),
  )("$key in $locale fits the provider budget", ({ locale, key }) => {
    // A safety message that does not fit would be truncated on the wire, so
    // the budget is asserted on the reviewed strings themselves.
    expect(t(locale, key).length).toBeLessThanOrEqual(USSD_MAX_BODY_CHARS);
  });
});

describe("resolveLocale", () => {
  it("passes through a supported locale", () => {
    expect(resolveLocale("sw")).toBe("sw");
  });

  it("narrows a regional tag to its base language", () => {
    expect(resolveLocale("sw-KE")).toBe("sw");
    expect(resolveLocale("en_GB")).toBe("en");
  });

  it("falls back to the default for anything unsupported", () => {
    expect(resolveLocale("fr")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale("")).toBe(DEFAULT_LOCALE);
  });

  it("recognises supported locales", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("fr")).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });
});

describe("t", () => {
  it("interpolates named variables", () => {
    expect(t("en", "channel.prompt.notUnderstood", { hint: "Try 1 or 2." })).toContain(
      "Try 1 or 2.",
    );
  });

  it("leaves an unsupplied placeholder visible rather than emitting an empty gap", () => {
    expect(t("en", "channel.prompt.notUnderstood")).toContain("{{hint}}");
  });

  it("falls back to English for a locale that lacks a key, then to the key", () => {
    expect(t("fr", "channel.choice.yes")).toBe("Yes");
    expect(t("en", "does.not.exist")).toBe("does.not.exist");
  });

  it("does not translate safety strings differently per call", () => {
    expect(t("sw", "channel.safety.ussd.emergency")).toBe(
      t("sw", "channel.safety.ussd.emergency"),
    );
  });
});

describe("diagnosis-language guard on reviewed strings", () => {
  /**
   * The product constitution forbids diagnostic assertion or speculation in
   * patient-facing output (spec §1.1, §14). The reviewed locale files are
   * patient-facing, so they are checked directly rather than only at runtime.
   */
  const prohibited = [
    // "you have <condition>" is diagnostic; "you have read/taken/…" is not, so
    // benign continuations are excluded rather than the whole phrase allowed.
    /\byou (?:may |might |probably |likely )?have\b(?!\s+(?:read|reported|described|told|measured|taken|been|already|any|no|not|to)\b)/i,
    /this sounds like/i,
    /this is likely/i,
    /this could be/i,
    /these symptoms suggest/i,
    /possible diagnosis/i,
    /differential diagnosis/i,
    /\buna ugonjwa\b/i,
    /\bunaonekana kuwa na\b/i,
    /inaonekana kama\b/i,
  ];

  it.each(supportedLocales)("%s contains no diagnostic assertion", (locale) => {
    for (const key of ALL_KEYS) {
      const value = t(locale, key);
      for (const pattern of prohibited) {
        expect(pattern.test(value), `${locale}:${key} -> ${value}`).toBe(false);
      }
    }
  });
});
