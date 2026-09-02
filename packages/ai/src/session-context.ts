import type { UrgencyClass } from "@kkd/contracts";

export interface SessionContext {
  facts: Array<{
    id: string;
    kind: string;
    value: unknown;
    confidence: string;
  }>;
  symptoms?: unknown[];
  missingFieldIds?: string[];
  urgency?: UrgencyClass;
}

export interface SessionContextReader {
  load(sessionId: string): Promise<SessionContext>;
}
