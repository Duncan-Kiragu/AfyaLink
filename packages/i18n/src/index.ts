import en from "./locales/en.json" with { type: "json" };
import sw from "./locales/sw.json" with { type: "json" };

export const supportedLocales = ["en", "sw"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

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
] as const;
