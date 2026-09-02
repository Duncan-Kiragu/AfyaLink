const ENGLISH_PATTERNS = [
  /\byou have\b/i,
  /\byou may have\b/i,
  /\byou probably have\b/i,
  /\bthis sounds like\b/i,
  /\bthis is likely\b/i,
  /\bthis could be\b/i,
  /\bthese symptoms suggest\b/i,
  /\bpossible diagnosis\b/i,
  /\bdifferential diagnosis\b/i,
];

const KISWAHILI_PATTERNS = [
  /\bunaweza kuwa na\b/i,
  /\buna ugonjwa\b/i,
  /\bhii inafanana na\b/i,
  /\butambuzi\b/i,
];

export function containsDiagnosticLanguage(text: string): boolean {
  return [...ENGLISH_PATTERNS, ...KISWAHILI_PATTERNS].some((pattern) =>
    pattern.test(text),
  );
}

export function stripDiagnosticLanguage(text: string): string {
  if (!containsDiagnosticLanguage(text)) {
    return text;
  }
  return "A factual account of what was reported is available. Seek professional care based on the urgency shown. KKD does not diagnose.";
}
