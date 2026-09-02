import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { AiOutputInvalidError } from "./errors.js";

export interface ClaudeStructuredRequest<TSchema extends z.ZodType> {
  model: string;
  maxTokens: number;
  system: string;
  user: string;
  schema: TSchema;
}

export interface ClaudeStructuredResult<T> {
  output: T;
  model: string;
}

export interface ClaudeStructuredClient {
  parse<TSchema extends z.ZodType>(
    request: ClaudeStructuredRequest<TSchema>,
  ): Promise<ClaudeStructuredResult<z.infer<TSchema>>>;
}

export function createAnthropicStructuredClient(
  client: Anthropic,
): ClaudeStructuredClient {
  return {
    async parse(request) {
      const message = await client.messages.parse({
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        output_config: {
          format: zodOutputFormat(request.schema),
        },
      });

      if (message.parsed_output == null) {
        throw new AiOutputInvalidError("Claude returned no parsed structured output");
      }

      return {
        output: message.parsed_output as z.infer<typeof request.schema>,
        model: message.model,
      };
    },
  };
}
