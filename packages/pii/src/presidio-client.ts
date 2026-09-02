import { PiiRedactionFailedError } from "./errors.js";
import { mapPresidioEntity } from "./entity-map.js";
import { kenyanAdHocRecognizers } from "./ad-hoc-recognizers.js";
import type { AnalyzerEntity, PiiAnalyzer } from "./types.js";

interface PresidioAnalyzeHit {
  start: number;
  end: number;
  score?: number;
  entity_type: string;
}

export interface PresidioAnalyzerClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  language?: string;
  organizationIdentifiers?: string[];
}

export class PresidioAnalyzerClient implements PiiAnalyzer {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly language: string;
  private readonly organizationIdentifiers: string[];

  constructor(options: PresidioAnalyzerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.language = options.language ?? "en";
    this.organizationIdentifiers = options.organizationIdentifiers ?? [];
  }

  async analyze(text: string): Promise<AnalyzerEntity[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          language: this.language,
          score_threshold: 0.6,
          entities: ["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "LOCATION", "DATE_TIME"],
          ad_hoc_recognizers: kenyanAdHocRecognizers(this.organizationIdentifiers),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new PiiRedactionFailedError(
          `Presidio analyzer returned ${response.status}`,
        );
      }

      const hits = (await response.json()) as PresidioAnalyzeHit[];
      const entities: AnalyzerEntity[] = [];
      for (const hit of hits) {
        const mapped = mapPresidioEntity(hit.entity_type, text, hit.start, hit.end);
        if (mapped) {
          entities.push({ ...mapped, score: hit.score });
        }
      }
      return entities;
    } catch (error) {
      if (error instanceof PiiRedactionFailedError) {
        throw error;
      }
      throw new PiiRedactionFailedError(
        error instanceof Error ? error.message : "Presidio analyzer request failed",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
