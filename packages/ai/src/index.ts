import type { KkdAiService } from "@kkd/contracts";

export type { KkdAiService };

export class UnimplementedAiService implements KkdAiService {
  extractReportedFacts(): Promise<never> {
    return Promise.reject(new Error("@kkd/ai extractReportedFacts is not implemented"));
  }
  planNextQuestion(): Promise<never> {
    return Promise.reject(new Error("@kkd/ai planNextQuestion is not implemented"));
  }
  summarizeSession(): Promise<never> {
    return Promise.reject(new Error("@kkd/ai summarizeSession is not implemented"));
  }
  normalizeLanguage(): Promise<never> {
    return Promise.reject(new Error("@kkd/ai normalizeLanguage is not implemented"));
  }
}

export function createAiService(): KkdAiService {
  return new UnimplementedAiService();
}
