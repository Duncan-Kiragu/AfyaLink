import type { PiiClass, PiiFinding } from "@kkd/contracts";

export interface AnalyzerEntity {
  type: PiiClass;
  start: number;
  end: number;
  score?: number;
}

export interface PiiAnalyzer {
  analyze(text: string): Promise<AnalyzerEntity[]>;
}

export interface SessionPlaceholderStore {
  load(sessionId: string): Promise<Record<string, string>>;
  save(sessionId: string, map: Record<string, string>): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

export interface SanitizeContext {
  sessionId?: string;
}

export function span(type: PiiClass, start: number, end: number): PiiFinding {
  return { type, start, end };
}
