import type { PiiService } from "@kkd/contracts";
import { aiRegressionCases } from "@kkd/testing";
import { describe, expect, it, vi } from "vitest";
import { ClaudeAiService } from "./claude-ai-service.js";
import type { ClaudeStructuredClient } from "./claude-client.js";
import { AiPiiBlockedError, AiSessionContextMissingError } from "./errors.js";
import { CLINICAL_SYSTEM_PREAMBLE } from "./prompts/shared.js";
import { prompts } from "./prompts/index.js";

function createPii(overrides?: Partial<PiiService>): PiiService {
  return {
    detect: async () => [],
    sanitizeObject: async (value) => {
      if (typeof value === "string") {
        return value.replace(/[\w.+-]+@[\w.-]+\.\w+/g, "[EMAIL_1]") as typeof value;
      }
      if (value && typeof value === "object") {
        return JSON.parse(
          JSON.stringify(value).replace(/[\w.+-]+@[\w.-]+\.\w+/g, "[EMAIL_1]"),
        ) as typeof value;
      }
      return value;
    },
    ...overrides,
  };
}

describe("ClaudeAiService", () => {
  it("redacts PII before calling Claude and stamps prompt metadata", async () => {
    const parse = vi.fn().mockResolvedValue({
      output: {
        facts: [
          { id: "pain-1", kind: "pain", value: "7/10", confidence: "explicit" },
        ],
      },
      model: "claude-sonnet-4-6",
    });
    const service = new ClaudeAiService({
      apiKey: "test-key",
      pii: createPii(),
      claude: { parse } satisfies ClaudeStructuredClient,
    });

    const result = await service.extractReportedFacts({
      sessionId: "session-1",
      locale: "en",
      patientText: "Abdominal pain 7/10, email me at patient@example.com",
      existingFactIds: [],
    });

    expect(parse).toHaveBeenCalledOnce();
    const request = parse.mock.calls[0]?.[0] as {
      system: string;
      user: string;
      schema: unknown;
    };
    expect(request.system).toContain("never diagnose");
    expect(request.user).toContain("[EMAIL_1]");
    expect(request.user).not.toContain("patient@example.com");
    expect(request.user).toContain("7/10");
    expect(result).toMatchObject({
      promptId: prompts.extractReportedFacts.id,
      promptVersion: prompts.extractReportedFacts.version,
      model: "claude-sonnet-4-6",
      facts: [{ id: "pain-1", kind: "pain", value: "7/10", confidence: "explicit" }],
    });
  });

  it("fails closed when PII sanitization throws, without calling Claude", async () => {
    const parse = vi.fn();
    const service = new ClaudeAiService({
      apiKey: "test-key",
      pii: createPii({
        sanitizeObject: async () => {
          throw new Error("presidio unavailable");
        },
      }),
      claude: { parse } satisfies ClaudeStructuredClient,
    });

    await expect(
      service.extractReportedFacts({
        sessionId: "session-1",
        locale: "en",
        patientText: "My name is John Kamau",
        existingFactIds: [],
      }),
    ).rejects.toBeInstanceOf(AiPiiBlockedError);
    expect(parse).not.toHaveBeenCalled();
  });

  it("keeps diagnosis-seeking patient text in the user turn, not the system prompt", async () => {
    const parse = vi.fn().mockResolvedValue({
      output: { facts: [] },
      model: "claude-sonnet-4-6",
    });
    const service = new ClaudeAiService({
      apiKey: "test-key",
      pii: createPii(),
      claude: { parse } satisfies ClaudeStructuredClient,
    });

    for (const patientText of aiRegressionCases) {
      parse.mockClear();
      await service.extractReportedFacts({
        sessionId: "session-1",
        locale: "en",
        patientText,
        existingFactIds: [],
      });
      const request = parse.mock.calls[0]?.[0] as { system: string; user: string };
      expect(request.system).toBe(prompts.extractReportedFacts.system);
      expect(request.system).toContain(CLINICAL_SYSTEM_PREAMBLE.slice(0, 40));
      expect(request.user).toContain(patientText);
      expect(request.system).not.toContain(patientText);
    }
  });

  it("plans a question with prompt metadata", async () => {
    const parse = vi.fn().mockResolvedValue({
      output: { questionId: "onset", questionText: "When did the pain start?" },
      model: "claude-sonnet-4-6",
    });
    const service = new ClaudeAiService({
      apiKey: "test-key",
      pii: createPii(),
      claude: { parse } satisfies ClaudeStructuredClient,
    });

    const result = await service.planNextQuestion({
      sessionId: "session-1",
      locale: "en",
      missingFieldIds: ["onset"],
    });

    expect(result.questionId).toBe("onset");
    expect(result.promptId).toBe(prompts.planNextQuestion.id);
  });

  it("requires session context for summaries and copies rule-engine urgency", async () => {
    const parse = vi.fn().mockResolvedValue({
      output: {
        reasonForSeekingCare: "Abdominal pain",
        symptomsReported: ["abdominal pain"],
        severityAndMeasurements: ["pain 7/10"],
        associatedSymptoms: ["nausea"],
        symptomsExplicitlyDenied: ["diarrhoea"],
        medicationAlreadyTaken: [],
        relevantContext: [],
        unknownOrUnanswered: [],
        recommendedNextAction: "Seek in-person assessment today",
        urgency: "monitor",
      },
      model: "claude-sonnet-4-6",
    });

    const withoutContext = new ClaudeAiService({
      apiKey: "test-key",
      pii: createPii(),
      claude: { parse } satisfies ClaudeStructuredClient,
    });
    await expect(
      withoutContext.summarizeSession({
        sessionId: "session-1",
        locale: "en",
        channel: "web",
      }),
    ).rejects.toBeInstanceOf(AiSessionContextMissingError);

    const service = new ClaudeAiService({
      apiKey: "test-key",
      pii: createPii(),
      claude: { parse } satisfies ClaudeStructuredClient,
      sessionContext: {
        async load() {
          return {
            facts: [{ id: "pain-1", kind: "pain", value: "7/10", confidence: "explicit" }],
            urgency: "urgent_today",
          };
        },
      },
    });

    const summary = await service.summarizeSession({
      sessionId: "session-1",
      locale: "en",
      channel: "web",
    });
    expect(summary.urgency).toBe("urgent_today");
    expect(summary.promptId).toBe(prompts.summarizeSession.id);
  });

  it("normalizes language from redacted text", async () => {
    const parse = vi.fn().mockResolvedValue({
      output: { text: "Tumbo linauma [EMAIL_1]", locale: "sw" },
      model: "claude-sonnet-4-6",
    });
    const service = new ClaudeAiService({
      apiKey: "test-key",
      pii: createPii(),
      claude: { parse } satisfies ClaudeStructuredClient,
    });

    const result = await service.normalizeLanguage({
      text: "Tumbo linauma, niandikie patient@example.com",
      localeHint: "sw",
    });
    expect(result.locale).toBe("sw");
    expect(parse.mock.calls[0]?.[0]).toMatchObject({
      user: expect.stringContaining("[EMAIL_1]"),
    });
  });
});
