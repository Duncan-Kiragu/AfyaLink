# Engineering conventions

Scaffolding only. Implement behavior in the owning workstream; do not add a second session model, diagnostic engine, or channel-specific clinical path.

## Ownership

| Path | Owner | First ticket |
| --- | --- | --- |
| Repo bootstrap, `apps/api`, `apps/worker`, `packages/{config,observability,ai,integrations}` | Evans | KKD-BOOT-001 |
| `packages/pii` | Evans | KKD-PII-001 |
| `packages/scoring`, `apps/api/src/modules/records`, `supabase` record tables | Duncan | KKD-RECORDS-001 |
| `packages/clinical-safety`, profiling | Antonia | KKD-SAFETY-001 |
| `apps/api/src/modules/{location,providers}`, geo adapters | Hassan | KKD-CARE-001 |
| `apps/web`, `packages/ui`, `packages/i18n` | Brian | KKD-WEB-001 |
| WhatsApp / USSD modules + channel adapters | Noordin | KKD-CHANNELS-001 |
| Voice module + ElevenLabs adapter | Dancun | KKD-VOICE-001 |
| `apps/mcp` | Evans + Antonia | KKD-MCP-001 |

## Packages

- Scope is `@kkd/<name>`. Depend with `"workspace:*"`.
- Public API is `src/index.ts` only. Import `@kkd/contracts`, never copy types into an app.
- Runtime config is `@kkd/config`. Do not read `process.env` in feature code.
- Claude is `@kkd/ai` only. Route handlers must not import `@anthropic-ai/sdk`.
- External HTTP is `@kkd/integrations` adapters. No one-off `fetch` to providers inside features.
- Logs/Sentry go through `@kkd/observability`. Do not log request bodies, transcripts, or PII.

## Apps

### `apps/web`

```
src/app/          providers, router, error boundary
src/routes/       one file per URL from the spec
src/features/     product slices (disclosure, conversation, summary, voice, …)
src/components/   presentational only
src/i18n/         web wiring; strings live in @kkd/i18n
src/api/          wraps @kkd/api-client
src/privacy/      client-side privacy helpers (no localStorage for anonymous chat)
```

Browser env vars must be `VITE_*`. Service-role keys are forbidden here.

### `apps/api`

Module layout: `src/modules/<name>/<name>.routes.ts`.

Middleware order is fixed:

1. request-id
2. security headers
3. CORS / origin check
4. body-size limit
5. auth (where required)
6. rate limit
7. request schema validation
8. handler / service
9. response schema validation
10. privacy-safe telemetry

Version prefix is `/api/v1`. Channel webhooks stay out of product resource routes.

### `apps/worker`

One processor file per queue in `src/processors/`. Job payloads are Zod schemas in `@kkd/contracts`. Queue names: `followups`, `notifications`, `provider-sync`, `voice-callbacks`, `exports`, `purges`, `analytics`.

Safety/urgency evaluation is **not** a job. It runs synchronously in the API.

### `apps/mcp`

Tools wrap the same services as the API. There is no `kkd.diagnose` tool.

## Redis keys

```
kkd:session:{sessionId}
kkd:ratelimit:{key}
kkd:cache:{provider}:{key}
kkd:lock:{resource}
kkd:bull:{queue}
```

Anonymous clinic payloads never go to Supabase.

## Tests

- Unit: `*.test.ts` next to the source file, Vitest.
- Integration: `*.integration.test.ts` (Redis, Supabase, mocked Claude, BullMQ).
- AI regression corpus: `packages/testing/src/regression`.
- E2E: `e2e/` Playwright.
- RLS: `supabase/tests/`.

## Definition of done (every workstream)

Shared contract, schema validation at the boundary, explicit anonymous vs persistent behavior, diagnosis-language guard, no health-data leakage in logs, tests, and an implementation note in the package.
