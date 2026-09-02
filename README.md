# *Kazi, Kabla ya Daktari (KKD)* - AfyaLink

TypeScript monorepo for the AfyaLink platform. This repository currently contains **scaffolding only**: folder conventions, shared contracts, and pinned dependencies. Feature work belongs in the workstream packages below, not in one-off copies of session, safety, or AI logic.

Product rules (never diagnose, ephemeral clinic sessions, AI disclosure first) are in `docs/requirements/`. File conventions are in `docs/architecture/conventions.md`.

## Stack

| Layer | Technology |
| --- | --- |
| Web | React + Vite + TypeScript |
| API | Express.js + TypeScript |
| Auth / Postgres | Supabase |
| Ephemeral state | Redis |
| Jobs | BullMQ |
| LLM | Claude API (via `@kkd/ai` only) |
| WhatsApp | Baileys (WhatsApp Web multi-device) |
| USSD | Africa's Talking |
| Voice | ElevenLabs |
| MCP | Model Context Protocol TypeScript SDK v2 |
| Tests | Vitest, React Testing Library, Supertest, Playwright |

## Requirements

- Node.js 24 (Active LTS), pinned in `.nvmrc`
- pnpm 11.23+, pinned in `package.json#packageManager`

```bash
nvm use
pnpm install
cp .env.example .env
pnpm dev
```

| Script | What it runs |
| --- | --- |
| `pnpm dev` | web, api, worker, mcp (Turbo) |
| `pnpm build` | production builds |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest |
| `pnpm test:e2e` | Playwright |

## Workspace map

```
apps/web          Patient-facing React app (Brian)
apps/api          Express `/api/v1` + shared conversation engine (Evans / shared)
apps/worker       BullMQ processors (Evans / feature owners)
apps/whatsapp     Baileys WhatsApp gateway, Render worker (Noordin)
apps/mcp          MCP HTTP server (Evans + Antonia)
packages/contracts     Zod schemas — import these, do not fork types
packages/ai            Claude client abstraction
packages/clinical-safety
packages/scoring
packages/pii
packages/i18n
packages/integrations  External API adapters
packages/observability
packages/config        Typed env
packages/api-client    Frontend HTTP wrapper
packages/ui            Shared React primitives
packages/testing       Fixtures and regression cases
```

Internal packages are consumed as TypeScript source (`workspace:*`). Do not publish them.

## Channels

WhatsApp and USSD are channel adapters over the **shared** conversation engine
in `apps/api/src/services/conversation`. No channel implements clinical
behaviour of its own.

- [Channel architecture](docs/architecture/channels.md)
- [Channel privacy data flow](docs/architecture/channel-privacy-data-flow.md)
- [WhatsApp gateway runbook](docs/runbooks/whatsapp-gateway.md)

Both are behind feature flags (`FEATURE_WHATSAPP`, `FEATURE_USSD`) and fail at
boot if enabled without their secrets. See `.env.example`.
