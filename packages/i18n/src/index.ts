import en from "./locales/en.json" with { type: "json" };
import sw from "./locales/sw.json" with { type: "json" };

export const supportedLocales = ["en", "sw"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

export const resources = {
  en: { translation: en },
  sw: { translation: sw },
} as const;

export const safetyCriticalKeys = [
  "disclosure.title",
  "disclosure.body",
  "disclosure.acknowledge",
  "urgency.emergency",
  "voice.notADiagnosis",
  "voice.sendToHospital",
  "voice.recordingOff",
  "consent.saveRecord",
  "privacy.settings",
  "error.retry",
  "channel.disclosure.whatsapp",
  "channel.disclosure.ussd",
  "channel.safety.emergency",
  "channel.safety.urgentToday",
  "channel.safety.soon",
  "channel.safety.monitor",
  "channel.safety.unknown",
  "channel.safety.unavailable",
  "channel.media.unsupported",
  "channel.persistence.notAvailable",
  "channel.session.closed",
  "channel.ussd.depthLimited",
] as const;

const catalogues: Record<SupportedLocale, Record<string, string>> = {
  en,
  sw,
};

export function isSupportedLocale(value: string | undefined): value is SupportedLocale {
  return typeof value === "string" && (supportedLocales as readonly string[]).includes(value);
}

/**
 * Narrows an arbitrary locale hint (browser header, channel metadata, provider
 * field) to a locale we have reviewed strings for. Hints are never trusted as
 * more than hints (spec §10.4B).
 */
export function resolveLocale(hint: string | undefined): SupportedLocale {
  if (!hint) return DEFAULT_LOCALE;
  if (isSupportedLocale(hint)) return hint;
  const base = hint.split(/[-_]/)[0]?.toLowerCase();
  return isSupportedLocale(base) ? base : DEFAULT_LOCALE;
}

export type TranslateVars = Record<string, string | number>;

/**
 * Server-side lookup for deterministic, reviewed strings. Safety-critical
 * wording must come from here rather than from a model at render time
 * (spec §10.4A). Falls back to English, then to the key itself, so a missing
 * translation degrades visibly in tests instead of emitting empty output.
 */
export function t(locale: string | undefined, key: string, vars?: TranslateVars): string {
  const resolved = resolveLocale(locale);
  const template = catalogues[resolved][key] ?? catalogues[DEFAULT_LOCALE][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Every locale must define every key; asserted in tests. */
export function missingKeys(locale: SupportedLocale): string[] {
  return Object.keys(catalogues[DEFAULT_LOCALE]).filter((key) => !(key in catalogues[locale]));
}
