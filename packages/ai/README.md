# `@kkd/ai`

Claude provider for KKD. Route handlers and channel adapters must not import `@anthropic-ai/sdk`.

## Behaviour

- `createAiService({ apiKey, pii })` returns `ClaudeAiService`.
- `createAiServiceFromEnv(env, pii)` returns `UnimplementedAiService` when `ANTHROPIC_API_KEY` is missing (local scaffold) and Claude otherwise.
- Every free-text payload is passed through `PiiService.sanitizeObject(value, "ai")` before Claude. If redaction throws, the call fails closed (`AiPiiBlockedError`) and nothing is sent.
- Structured outputs use Anthropic `messages.parse` + `zodOutputFormat`. Application code validates again with Zod.
- Prompt id, prompt version, and model name are stamped on every result. Prompts live in `src/prompts/` and are versioned in source control.
- Claude never owns urgency. `summarizeSession` copies the rule-engine urgency from `SessionContextReader` when present, otherwise `"unknown"`.
- `summarizeSession` needs a `SessionContextReader`. Session storage is owned by the API/session workstream.

## Wiring

```ts
import { createAiServiceFromEnv } from "@kkd/ai";
import { loadEnv } from "@kkd/config";

const env = loadEnv();
const ai = createAiServiceFromEnv(env, pii);
```

`pii` must implement `PiiService` from `@kkd/contracts`. The `@kkd/pii` workstream supplies the Presidio-backed implementation. Do not bypass it.

Default model: `claude-sonnet-4-6` when `ANTHROPIC_MODEL` is unset.
