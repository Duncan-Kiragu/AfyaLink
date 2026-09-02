import type { Env } from "@kkd/config";
import type { PiiFinding, PiiPolicy, PiiService } from "@kkd/contracts";
import { detectDeterministic } from "./deterministic.js";
import { PiiRedactionFailedError } from "./errors.js";
import { applyFindings, mergeFindings } from "./findings.js";
import { dropMedicalFalsePositives } from "./medical-preserve.js";
import { PlaceholderAllocator, restorePlaceholders } from "./placeholders.js";
import { PresidioAnalyzerClient } from "./presidio-client.js";
import { InMemorySessionPlaceholderStore } from "./session-store.js";
import type { PiiAnalyzer, SanitizeContext, SessionPlaceholderStore } from "./types.js";

const FAIL_CLOSED_POLICIES: PiiPolicy[] = ["ai", "job", "webhook", "session_reversible"];

export interface CreatePiiServiceOptions {
  analyzerUrl?: string;
  analyzer?: PiiAnalyzer;
  fetch?: typeof fetch;
  timeoutMs?: number;
  organizationIdentifiers?: string[];
  placeholderStore?: SessionPlaceholderStore;
  language?: string;
}

export class PresidioPiiService implements PiiService {
  private readonly analyzer?: PiiAnalyzer;
  private readonly organizationIdentifiers: string[];
  private readonly placeholderStore: SessionPlaceholderStore;

  constructor(options: CreatePiiServiceOptions = {}) {
    this.organizationIdentifiers = options.organizationIdentifiers ?? [];
    this.placeholderStore =
      options.placeholderStore ?? new InMemorySessionPlaceholderStore();
    this.analyzer =
      options.analyzer ??
      (options.analyzerUrl
        ? new PresidioAnalyzerClient({
            baseUrl: options.analyzerUrl,
            fetch: options.fetch,
            timeoutMs: options.timeoutMs,
            language: options.language,
            organizationIdentifiers: this.organizationIdentifiers,
          })
        : undefined);
  }

  async detect(text: string): Promise<PiiFinding[]> {
    return this.findingsFor(text, "log");
  }

  async sanitizeObject<T>(
    value: T,
    policy: PiiPolicy,
    context: SanitizeContext = {},
  ): Promise<T> {
    const existing =
      policy === "session_reversible" && context.sessionId
        ? await this.placeholderStore.load(context.sessionId)
        : {};
    const allocator = new PlaceholderAllocator(
      policy === "log" || policy === "analytics" ? "irreversible" : "reversible",
      existing,
    );

    const sanitized = await this.walk(value, policy, allocator);

    if (policy === "session_reversible" && context.sessionId) {
      await this.placeholderStore.save(context.sessionId, allocator.toRecord());
    }

    return sanitized;
  }

  async restore(text: string, sessionId: string): Promise<string> {
    const map = await this.placeholderStore.load(sessionId);
    return restorePlaceholders(text, map);
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.placeholderStore.clear(sessionId);
  }

  private async walk<T>(
    value: T,
    policy: PiiPolicy,
    allocator: PlaceholderAllocator,
  ): Promise<T> {
    if (typeof value === "string") {
      return (await this.sanitizeText(value, policy, allocator)) as T;
    }
    if (Array.isArray(value)) {
      const items = [];
      for (const item of value) {
        items.push(await this.walk(item, policy, allocator));
      }
      return items as T;
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      const result: Record<string, unknown> = {};
      for (const [key, nested] of entries) {
        result[key] = await this.walk(nested, policy, allocator);
      }
      return result as T;
    }
    return value;
  }

  private async sanitizeText(
    text: string,
    policy: PiiPolicy,
    allocator: PlaceholderAllocator,
  ): Promise<string> {
    const findings = await this.findingsFor(text, policy);
    return applyFindings(text, findings, (finding, original) =>
      allocator.assign(finding.type, original),
    );
  }

  private async findingsFor(text: string, policy: PiiPolicy): Promise<PiiFinding[]> {
    const deterministic = detectDeterministic(text, this.organizationIdentifiers);
    const fromAnalyzer = await this.analyzerFindings(text, policy);
    return dropMedicalFalsePositives(
      text,
      mergeFindings([...deterministic, ...fromAnalyzer]),
    );
  }

  private async analyzerFindings(text: string, policy: PiiPolicy): Promise<PiiFinding[]> {
    const failClosed = FAIL_CLOSED_POLICIES.includes(policy);

    if (!this.analyzer) {
      if (failClosed) {
        throw new PiiRedactionFailedError(
          "Presidio analyzer is not configured; refusing to send unredacted data",
        );
      }
      return [];
    }

    try {
      const entities = await this.analyzer.analyze(text);
      return entities.map((entity) => ({
        type: entity.type,
        start: entity.start,
        end: entity.end,
      }));
    } catch (error) {
      if (failClosed) {
        throw error instanceof PiiRedactionFailedError
          ? error
          : new PiiRedactionFailedError(
              error instanceof Error ? error.message : "Presidio analyzer failed",
            );
      }
      return [];
    }
  }
}

export function createPiiService(
  options: CreatePiiServiceOptions = {},
): PresidioPiiService {
  return new PresidioPiiService(options);
}

export function createPiiServiceFromEnv(
  env: Env,
  options: Omit<CreatePiiServiceOptions, "analyzerUrl"> = {},
): PresidioPiiService {
  return createPiiService({
    ...options,
    analyzerUrl: env.PRESIDIO_ANALYZER_URL,
  });
}
