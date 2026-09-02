import type { Env } from "@kkd/config";
import type {
  ConsultationSummary,
  ExtractFactsInput,
  KkdAiService,
  NormalizeLanguageInput,
  NormalizedText,
  PiiService,
  QuestionPlan,
  QuestionPlanInput,
  ReportedFacts,
  SummaryInput,
} from "@kkd/contracts";
import Anthropic from "@anthropic-ai/sdk";
import {
  createAnthropicStructuredClient,
  type ClaudeStructuredClient,
} from "./claude-client.js";
import {
  AiConfigurationError,
  AiOutputInvalidError,
  AiPiiBlockedError,
  AiSessionContextMissingError,
} from "./errors.js";
import {
  consultationSummaryModelSchema,
  extractedFactsModelSchema,
  normalizedTextModelSchema,
  questionPlanModelSchema,
} from "./model-schemas.js";
import { prompts } from "./prompts/index.js";
import type { SessionContextReader } from "./session-context.js";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";

export interface CreateAiServiceOptions {
  apiKey: string;
  model?: string;
  pii: PiiService;
  anthropic?: Anthropic;
  claude?: ClaudeStructuredClient;
  sessionContext?: SessionContextReader;
}

export class ClaudeAiService implements KkdAiService {
  private readonly model: string;
  private readonly pii: PiiService;
  private readonly claude: ClaudeStructuredClient;
  private readonly sessionContext?: SessionContextReader;

  constructor(options: CreateAiServiceOptions) {
    if (!options.apiKey && !options.claude && !options.anthropic) {
      throw new AiConfigurationError("ANTHROPIC_API_KEY is required to create ClaudeAiService");
    }

    this.model = options.model ?? DEFAULT_ANTHROPIC_MODEL;
    this.pii = options.pii;
    this.sessionContext = options.sessionContext;
    this.claude =
      options.claude ??
      createAnthropicStructuredClient(
        options.anthropic ?? new Anthropic({ apiKey: options.apiKey }),
      );
  }

  async extractReportedFacts(input: ExtractFactsInput): Promise<ReportedFacts> {
    const patientText = await this.redactForAi(input.patientText);
    const prompt = prompts.extractReportedFacts;
    const { output, model } = await this.claude.parse({
      model: this.model,
      maxTokens: 1024,
      system: prompt.system,
      schema: extractedFactsModelSchema,
      user: JSON.stringify({
        locale: input.locale,
        existingFactIds: input.existingFactIds,
        patientText,
      }),
    });

    return {
      facts: output.facts,
      promptId: prompt.id,
      promptVersion: prompt.version,
      model,
    };
  }

  async planNextQuestion(input: QuestionPlanInput): Promise<QuestionPlan> {
    const prompt = prompts.planNextQuestion;
    const { output, model } = await this.claude.parse({
      model: this.model,
      maxTokens: 512,
      system: prompt.system,
      schema: questionPlanModelSchema,
      user: JSON.stringify({
        locale: input.locale,
        missingFieldIds: input.missingFieldIds,
      }),
    });

    return {
      questionId: output.questionId,
      questionText: output.questionText,
      promptId: prompt.id,
      promptVersion: prompt.version,
      model,
    };
  }

  async summarizeSession(input: SummaryInput): Promise<ConsultationSummary> {
    if (!this.sessionContext) {
      throw new AiSessionContextMissingError("summarizeSession");
    }

    const context = await this.sessionContext.load(input.sessionId);
    const redacted = await this.redactForAi({
      locale: input.locale,
      channel: input.channel,
      facts: context.facts,
      symptoms: context.symptoms ?? [],
      missingFieldIds: context.missingFieldIds ?? [],
      urgency: context.urgency ?? "unknown",
    });

    const prompt = prompts.summarizeSession;
    const { output, model } = await this.claude.parse({
      model: this.model,
      maxTokens: 2048,
      system: prompt.system,
      schema: consultationSummaryModelSchema,
      user: JSON.stringify(redacted),
    });

    const parsed = consultationSummaryModelSchema.safeParse(output);
    if (!parsed.success) {
      throw new AiOutputInvalidError("Claude summary failed Zod validation");
    }

    return {
      ...parsed.data,
      urgency: context.urgency ?? "unknown",
      promptId: prompt.id,
      promptVersion: prompt.version,
      model,
    };
  }

  async normalizeLanguage(input: NormalizeLanguageInput): Promise<NormalizedText> {
    const text = await this.redactForAi(input.text);
    const prompt = prompts.normalizeLanguage;
    const { output } = await this.claude.parse({
      model: this.model,
      maxTokens: 512,
      system: prompt.system,
      schema: normalizedTextModelSchema,
      user: JSON.stringify({
        localeHint: input.localeHint,
        text,
      }),
    });

    return output;
  }

  private async redactForAi<T>(value: T): Promise<T> {
    try {
      return await this.pii.sanitizeObject(value, "ai");
    } catch (error) {
      throw new AiPiiBlockedError(
        error instanceof Error ? error.message : "PII redaction failed",
      );
    }
  }
}

export function createAiService(options: CreateAiServiceOptions): KkdAiService {
  return new ClaudeAiService(options);
}

export function createAiServiceFromEnv(
  env: Env,
  pii: PiiService,
  sessionContext?: SessionContextReader,
): KkdAiService {
  if (!env.ANTHROPIC_API_KEY) {
    return new UnimplementedAiService();
  }

  return createAiService({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
    pii,
    sessionContext,
  });
}

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
