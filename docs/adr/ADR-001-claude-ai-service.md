# ADR-001: Claude is the only LLM, behind `@kkd/ai`

## Status

Accepted

## Context

KKD needs structured symptom extraction, question planning, language normalization, and consultation summaries. Route handlers must not call a model SDK directly, and free-text must be PII-redacted before any third-party call.

## Decision

- Anthropic Claude is the sole LLM provider.
- All Claude access goes through `ClaudeAiService` in `@kkd/ai`.
- Structured outputs use `messages.parse` with `zodOutputFormat`, then Zod at the application boundary.
- Prompts are versioned files in `packages/ai/src/prompts`.
- `PiiService` is injected. AI fails closed if redaction fails.
- Urgency is not decided by Claude; the safety engine remains the source of truth.

## Consequences

- Changing models is an env/config change (`ANTHROPIC_MODEL`), not a feature-package rewrite.
- Conversation, WhatsApp, USSD, voice, and MCP can share one client.
- `summarizeSession` depends on a session context reader that the API workstream must supply.
