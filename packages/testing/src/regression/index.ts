export const regressionSuiteFolders = [
  "self-diagnosis",
  "red-flags",
  "ambiguous",
  "missing-critical-data",
  "english",
  "kiswahili",
  "code-switching",
  "prompt-injection",
] as const;

export type RegressionSuiteFolder = (typeof regressionSuiteFolders)[number];

export * from "./diagnosis-language.js";
