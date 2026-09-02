import type { PiiClass, PiiFinding } from "@kkd/contracts";
import { span } from "./types.js";

interface Pattern {
  type: PiiClass;
  regex: RegExp;
  group?: number;
}

const PATTERNS: Pattern[] = [
  {
    type: "email",
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    type: "phone",
    regex: /(?<!\d)(?:\+?254|0)[-.\s]?(?:7|1)\d[-.\s]?\d{3}[-.\s]?\d{3,4}(?!\d)/g,
  },
  {
    type: "coordinates",
    regex: /[-+]?\d{1,2}\.\d{4,}\s*,\s*[-+]?\d{1,3}\.\d{4,}/g,
  },
  {
    type: "coordinates",
    regex: /(?:lat(?:itude)?|lng|lon(?:gitude)?|gps)\s*[:=]?\s*[-+]?\d{1,3}\.\d+/gi,
  },
  {
    type: "national_id",
    regex: /(?:national\s*id|kitambulisho|nida|id(?:\s*number)?)\s*[:#]?\s*(\d{7,8})/gi,
    group: 1,
  },
  {
    type: "national_id",
    regex: /(?:passport)\s*[:#]?\s*([A-Z]{1,2}\d{6,9})/gi,
    group: 1,
  },
  {
    type: "account_reference",
    regex:
      /(?:account|ref(?:erence)?|file)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9-]{6,})/gi,
    group: 1,
  },
  {
    type: "date_of_birth",
    regex:
      /(?:dob|date\s*of\s*birth|born\s*on|tarehe\s*ya\s*kuzaliwa)\s*[:#]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/gi,
    group: 1,
  },
];

const SENSITIVE_QUERY_KEYS =
  /^(?:phone|email|name|id|national[_-]?id|token|account|ref|patient|user)$/i;

const NAME_TRIGGERS = /(?:my name is|jina langu ni|naitwa|nina itwa)\s+/gi;
const NAME_STOP = new Set([
  "na",
  "and",
  "lakini",
  "but",
  "with",
  "nina",
  "have",
  "nime",
  "nilikuwa",
  "my",
  "the",
  "tumbo",
  "pain",
]);

function detectIntroducedNames(text: string): PiiFinding[] {
  const findings: PiiFinding[] = [];
  NAME_TRIGGERS.lastIndex = 0;
  for (const match of text.matchAll(NAME_TRIGGERS)) {
    const namesStart = (match.index ?? 0) + match[0].length;
    const tail = text.slice(namesStart);
    const tokenRegex = /[A-Za-z][A-Za-z'-]*/g;
    const names: Array<{ start: number; end: number }> = [];
    for (const token of tail.matchAll(tokenRegex)) {
      if (NAME_STOP.has(token[0].toLowerCase()) || names.length >= 4) {
        break;
      }
      const start = namesStart + (token.index ?? 0);
      names.push({ start, end: start + token[0].length });
    }
    const last = names.at(-1);
    const first = names[0];
    if (!first || !last) {
      continue;
    }
    findings.push(span("person_name", first.start, last.end));
  }
  return findings;
}

function matchGroupOffset(full: string, group: string, matchIndex: number): number {
  const offsetInMatch = full.indexOf(group);
  return matchIndex + (offsetInMatch >= 0 ? offsetInMatch : 0);
}

function scanUrls(text: string): PiiFinding[] {
  const findings: PiiFinding[] = [];
  const urlRegex = /\bhttps?:\/\/[^\s<>"']+/gi;
  for (const match of text.matchAll(urlRegex)) {
    const raw = match[0];
    const start = match.index ?? 0;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!SENSITIVE_QUERY_KEYS.test(key) || !value) {
        continue;
      }
      const valueOffset = raw.indexOf(value);
      if (valueOffset < 0) {
        continue;
      }
      findings.push(
        span(
          "account_reference",
          start + valueOffset,
          start + valueOffset + value.length,
        ),
      );
    }
  }
  return findings;
}

export function detectDeterministic(
  text: string,
  organizationIdentifiers: string[] = [],
): PiiFinding[] {
  const findings: PiiFinding[] = [];

  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      const full = match[0];
      const index = match.index ?? 0;
      if (pattern.group != null) {
        const group = match[pattern.group];
        if (!group) {
          continue;
        }
        const start = matchGroupOffset(full, group, index);
        findings.push(span(pattern.type, start, start + group.length));
      } else {
        findings.push(span(pattern.type, index, index + full.length));
      }
    }
  }

  for (const identifier of organizationIdentifiers) {
    if (!identifier) {
      continue;
    }
    let from = 0;
    const lowerText = text.toLowerCase();
    const lowerId = identifier.toLowerCase();
    while (from < text.length) {
      const at = lowerText.indexOf(lowerId, from);
      if (at < 0) {
        break;
      }
      findings.push(span("org_identifier", at, at + identifier.length));
      from = at + identifier.length;
    }
  }

  findings.push(...scanUrls(text));
  findings.push(...detectIntroducedNames(text));
  return findings;
}
