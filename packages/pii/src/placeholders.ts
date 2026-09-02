import type { PiiClass } from "@kkd/contracts";

const PREFIX: Record<PiiClass, string> = {
  person_name: "PERSON",
  phone: "PHONE",
  email: "EMAIL",
  national_id: "NATIONAL_ID",
  address: "ADDRESS",
  coordinates: "COORDINATES",
  account_reference: "ACCOUNT",
  date_of_birth: "DOB",
  org_identifier: "ORG",
};

export class PlaceholderAllocator {
  private readonly counters = new Map<PiiClass, number>();
  private readonly seen = new Map<string, string>();
  readonly reverse = new Map<string, string>();

  constructor(
    private readonly mode: "irreversible" | "reversible",
    existingReverse: Record<string, string> = {},
  ) {
    for (const [placeholder, original] of Object.entries(existingReverse)) {
      this.reverse.set(placeholder, original);
      const match = /^\[([A-Z_]+)_(\d+)\]$/.exec(placeholder);
      if (!match) {
        continue;
      }
      const prefix = match[1];
      const index = Number(match[2]);
      const type = (Object.entries(PREFIX).find(([, value]) => value === prefix)?.[0] ??
        "org_identifier") as PiiClass;
      this.seen.set(`${type}:${original}`, placeholder);
      this.counters.set(type, Math.max(this.counters.get(type) ?? 0, index));
    }
  }

  assign(type: PiiClass, original: string): string {
    const key = `${type}:${original}`;
    const cached = this.seen.get(key);
    if (cached) {
      return cached;
    }

    if (this.mode === "irreversible") {
      const token = `[REDACTED:${type}]`;
      this.seen.set(key, token);
      return token;
    }

    const next = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, next);
    const token = `[${PREFIX[type]}_${next}]`;
    this.seen.set(key, token);
    this.reverse.set(token, original);
    return token;
  }

  toRecord(): Record<string, string> {
    return Object.fromEntries(this.reverse);
  }
}

export function restorePlaceholders(text: string, map: Record<string, string>): string {
  let restored = text;
  for (const [placeholder, original] of Object.entries(map)) {
    restored = restored.split(placeholder).join(original);
  }
  return restored;
}
