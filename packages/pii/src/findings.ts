import type { PiiFinding } from "@kkd/contracts";

export function mergeFindings(findings: PiiFinding[]): PiiFinding[] {
  const sorted = [...findings].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return b.end - a.end;
  });

  const merged: PiiFinding[] = [];
  for (const finding of sorted) {
    if (finding.end <= finding.start) {
      continue;
    }
    const previous = merged.at(-1);
    if (!previous || finding.start >= previous.end) {
      merged.push({ ...finding });
      continue;
    }
    if (finding.end > previous.end) {
      previous.end = finding.end;
    }
  }
  return merged;
}

export function applyFindings(
  text: string,
  findings: PiiFinding[],
  replace: (finding: PiiFinding, original: string) => string,
): string {
  let result = text;
  for (const finding of [...findings].sort((a, b) => b.start - a.start)) {
    const original = result.slice(finding.start, finding.end);
    result =
      result.slice(0, finding.start) +
      replace(finding, original) +
      result.slice(finding.end);
  }
  return result;
}
