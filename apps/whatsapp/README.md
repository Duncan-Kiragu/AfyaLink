# `@kkd/whatsapp-gateway`

The KKD WhatsApp transport, built on [Baileys](https://baileys.wiki).

Holds one WhatsApp Web multi-device WebSocket, forwards inbound messages to the
shared conversation engine over the API, and sends the engine's replies back.

**It contains no clinical logic and authors no patient-facing text.** If the API
is unreachable it stays silent rather than inventing a reply.

## Run

```bash
pnpm --filter @kkd/whatsapp-gateway dev     # prints a pairing QR on first run
pnpm --filter @kkd/whatsapp-gateway start
```

Deployed as a Render **background worker** (`kkd-whatsapp-*`), never a scaled web
service: WhatsApp allows one linked-device session per credential set, and two
sockets on the same credentials log each other out. A Redis lock
(`kkd:lock:channel:whatsapp:socket`) makes that single-writer rule enforced
rather than assumed — a second instance stays idle, and a holder that loses the
lock exits so Render restarts it into standby.

## Layout

| File | Role |
| --- | --- |
| `src/index.ts` | boot, env validation, QR output, graceful shutdown |
| `src/gateway.ts` | wires the adapter, lock, auth state, and API client |
| `src/api-client.ts` | HMAC-signed client for the gateway → API hop |
| `src/socket-lock.ts` | single-writer Redis lock with TTL renewal |

The Baileys adapter itself lives in
[`packages/integrations/src/whatsapp`](../../packages/integrations/src/whatsapp)
so that the transport is swappable behind `ConversationChannelAdapter`.

## Docs

- [Channel architecture](../../docs/architecture/channels.md) — design and the
  reasoning behind Baileys vs. the Meta Cloud API, and numbered menus vs. native
  interactive buttons.
- [Privacy data flow](../../docs/architecture/channel-privacy-data-flow.md)
- [Runbook](../../docs/runbooks/whatsapp-gateway.md) — pairing, rotation,
  staging validation, failure modes.
