import type { PiiFinding } from "@kkd/contracts";

const MEDICAL_SPANS: RegExp[] = [
  /\b(?:temperature|temp|fever|homa)\s*[:=]?\s*\d{2}(?:\.\d+)?\b/gi,
  /\b\d{2}(?:\.\d+)?\s*°?\s*c\b/gi,
  /\b(?:pain|uchungu)\s*(?:score|rated|is|of|ya)?\s*\d{1,2}\s*(?:\/\s*10)?/gi,
  /\b\d{1,2}\s*\/\s*10\b/gi,
  /\b\d+(?:\.\d+)?\s*(?:mg|ml|mcg|iu|tablets?|capsules?|dawa)\b/gi,
  /\b(?:for|last|past|over|kwa)\s+\d+\s*(?:minutes?|hours?|days?|weeks?|months?|dakika|masaa|siku|wiki|miezi)\b/gi,
  /\b\d+\s*(?:minutes?|hours?|days?|weeks?|months?|dakika|masaa|siku|wiki|miezi)\s+(?:ago|nyuma)\b/gi,
  /\bparacetamol\b/gi,
  /\bibuprofen\b/gi,
];

const BODY_PARTS =
  /\b(?:abdomen|abdominal|tumbo|chest|kifua|head|kichwa|throat|koo|back|mgongo|stomach|arm|mkono|leg|mguu|eye|jicho|ear|sikio|nose|pua|mouth|kinywa|neck|shingo|hip|knee|goti|ankle|wrist|shoulder|bega|flank|pelvis|loin|lower[- ]right|upper[- ]right|lower[- ]left|upper[- ]left)\b/i;

function collectMedicalSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const regex of MEDICAL_SPANS) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const start = match.index ?? 0;
      spans.push({ start, end: start + match[0].length });
    }
  }
  return spans;
}

function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

export function dropMedicalFalsePositives(
  text: string,
  findings: PiiFinding[],
): PiiFinding[] {
  const medical = collectMedicalSpans(text);
  return findings.filter((finding) => {
    const slice = text.slice(finding.start, finding.end).trim();
    if (
      (finding.type === "address" || finding.type === "person_name") &&
      BODY_PARTS.test(slice) &&
      slice.split(/\s+/).length <= 3 &&
      !slice.includes(",")
    ) {
      const onlyBodyPart = slice
        .toLowerCase()
        .replace(/[- ]/g, " ")
        .split(/\s+/)
        .every((word) =>
          /^(?:abdomen|abdominal|tumbo|chest|kifua|head|kichwa|throat|koo|back|mgongo|stomach|arm|mkono|leg|mguu|eye|jicho|ear|sikio|nose|pua|mouth|kinywa|neck|shingo|hip|knee|goti|ankle|wrist|shoulder|bega|flank|pelvis|loin|lower|upper|right|left)$/.test(
            word,
          ),
        );
      if (onlyBodyPart) {
        return false;
      }
    }
    return !medical.some(
      (span) =>
        overlaps(finding, span) &&
        finding.end - finding.start <= span.end - span.start + 2,
    );
  });
}
