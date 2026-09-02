# Workstream 7 — USSD + WhatsApp Conversation Interfaces

**Owner:** Noordin · **Spec:** §11 · **Status:** implemented (staging-ready)

## What this workstream owns

Channel adapters and interaction state. Nothing clinical. Every medical or
safety decision is delegated to the shared conversation engine, because §3.1
forbids a channel from growing its own diagnostic engine, symptom model, or
clinical conversation implementation.

| Layer | Owns | Does **not** own |
| --- | --- | --- |
| `packages/integrations/src/channel` | identity hashing, choice rendering/parsing, HMAC envelope, keyword commands | anything clinical |
| `packages/integrations/src/whatsapp` | Baileys socket lifecycle, auth state, inbound normalization, media policy | question content, urgency |
| `packages/integrations/src/ussd` | provider wire format, dialogue state machine, screen budget | question content, urgency |
| `apps/api/src/services/channels` | channel↔session mapping, disclosure gating, idempotency, cross-channel summary delivery | fact extraction, urgency |
| `apps/api/src/services/conversation` | the **shared** engine every channel calls | — |
| `apps/whatsapp` | the Baileys gateway process | any patient-facing text |

## Topology

```
                    ┌──────────────────────────────────────────┐
                    │  apps/api                                │
   React ──────────►│  /api/v1/sessions/*                      │
                    │        │                                 │
Africa's Talking ──►│  /api/v1/integrations/ussd               │
   (HMAC, form)     │        │                                 │
                    │        ▼                                 │
                    │  ConversationEngine  ◄── the only        │
                    │   (services/conversation/engine.ts)      │
                    │        │         clinical implementation │
                    │        ├── @kkd/ai            (Claude)   │
                    │        ├── @kkd/clinical-safety (rules)  │
                    │        └── Redis (ephemeral sessions)    │
                    │        ▲                                 │
                    │  /api/v1/integrations/whatsapp/inbound   │
                    └────────▲─────────────────────────────────┘
                             │ HMAC-signed, reply in the same response
                    ┌────────┴─────────────────────────────────┐
                    │  apps/whatsapp  (Render background worker)│
                    │  Baileys WebSocket ── WhatsApp Web MD     │
                    │  Redis: auth state + single-writer lock   │
                    └───────────────────────────────────────────┘
```

## Why WhatsApp is a gateway process, not a webhook

The spec was written around a webhook-style WhatsApp integration (§11.3A,
`WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`). The chosen transport is
**Baileys**, which speaks the WhatsApp Web multi-device protocol over a
WebSocket. That changes three things:

1. **There is no inbound HTTP request to verify.** The Noise handshake
   authenticates the transport itself. The remaining trust boundary is the
   gateway → API hop, and it carries the same discipline the spec demanded of a
   webhook: HMAC over the exact bytes, a timestamp to bound replay, and
   constant-time comparison (`packages/integrations/src/channel/signature.ts`).
2. **The connection is stateful and single-instance.** One WhatsApp
   linked-device session cannot be shared by two processes — they fight over the
   Signal ratchet and log each other out. Hence a dedicated Render *worker*
   (`kkd-whatsapp-stage`) plus a Redis lock (`SocketLock`) that makes the
   single-writer rule enforced rather than assumed. If a second instance starts,
   it stays idle; if a holder loses the lock, it exits so Render restarts it
   into the standby state.
3. **Session credentials must survive a deploy.** Baileys' bundled
   `useMultiFileAuthState` writes to local disk, which Render wipes on every
   deploy — that would force a QR re-pair each time. `useRedisAuthState` stores
   the account session as one Redis hash instead. That hash is a **credential**,
   not clinical content: it carries no TTL (a purge would log the number out)
   and must be treated as a secret at rest.

The four Meta Cloud API environment variables are retained but unused, so a
future migration to the Cloud API only needs a new adapter behind
`ConversationChannelAdapter`.

## Interactive buttons: why numbered menus instead

Spec §11.3D asks for interactive buttons/lists for yes/no, severity, consent,
language, and next action. Native interactive messages are a WhatsApp Business
**Cloud API** capability and are unreliable over the web protocol — Baileys does
not document them, and WhatsApp actively restricts them for non-Business
senders.

The requirement behind §11.3D is *unambiguous structured input on
safety-critical paths*, and that is met deterministically:

- the engine emits channel-neutral `ConversationChoice[]`;
- WhatsApp renders them as a numbered menu (`renderOutboundBody`);
- USSD renders the same list as a native numbered menu;
- replies are resolved by displayed number, choice id, rendered label, or a
  locale synonym — so `2`, `no`, and `hapana` all select the same option
  (`resolveChoiceReply`).

Native button/list replies **are** accepted when WhatsApp happens to deliver
them (`extractWhatsAppText` reads `buttonsResponseMessage`,
`listResponseMessage`, `templateButtonReplyMessage`), but nothing depends on
them arriving.

Keypresses resolve against **what the previous screen displayed**, not against
what the engine would ask next, so a late reply to a superseded prompt cannot be
mis-scored.

## Reliability (§11.5)

| Requirement | Implementation |
| --- | --- |
| Signature validation | `verifyChannelSignature`; unsigned/mis-signed/stale → `401`, reason code logged, never the body |
| Replay protection | `createIdempotencyStore` — Redis `SET NX` claim, then the response is memoised and replayed |
| Rate limiting | `channelRateLimiter` (600/min) mounted before the browser limiter; channel callbacks fan in every caller from one address |
| Provider outage | gateway stays silent rather than authoring a reply; USSD returns a terminal safe screen, never a 500 |
| Delivery status | `messages.update` → `/status`, logged as operational telemetry only, never stored per patient |
| No raw payloads in logs | Baileys logger pinned to `warn` outside local; adapters log class names and status codes only |

USSD idempotency replays the **previous screen** rather than serving the next
one. Serving the next screen for an aggregator retry would advance the caller
past a question they never answered.

## USSD dialogue

`disclosure → language → conversation → safety_outcome → summary_delivery → done`

Screen 1 carries a **compressed bilingual disclosure** with the language menu
below it. Disclosure comes first as §15 requires, but it has to be legible
before a language is known, and full-length localized disclosure text does not
fit a 178-character screen alongside a menu. Picking a language is the
affirmative acknowledgement; declining (option 3) closes the session without
acknowledging.

From `conversation` onward the screens render prompts the **shared engine**
emits, so the symptom category and the structured questions are the same
question pathway the web and WhatsApp use. A USSD-local question tree would be a
second clinical implementation.

Three USSD-specific constraints:

- **Screen budget.** Africa's Talking allows 182 characters per screen; the
  `CON `/`END ` prefix is reserved out of it. USSD has its own reviewed
  short-form safety strings (`channel.safety.ussd.*`) because the
  WhatsApp/web wording does not fit — an approved safety message must never be
  truncated. If an outcome plus even a single menu option would overflow, the
  dialogue ends on the intact safety message and the optional summary offer is
  dropped. Asserted for every urgency × locale in
  `state-machine.test.ts` and directly on the locale files in
  `packages/i18n/src/index.test.ts`.
- **Interaction depth (§11.4C).** After `USSD_MAX_SCREENS` (12) the dialogue
  ends with a professional-care recommendation rather than implying a
  menu-length interview was a complete assessment.
- **Accumulating input.** `latestUssdInput` reads only the final `*`-separated
  segment and keeps authoritative state in Redis, so an aggregator that does
  not accumulate works through the same code path.

`0` is reserved on every conversation screen for changing language, and is never
submitted as a clinical answer.

## Privacy and persistence boundaries

- **Identities are keyed hashes.** `createChannelIdentityHasher` HMACs a
  canonicalized identity with `CHANNEL_IDENTITY_SALT`. A keyed hash, not a bare
  digest, so a leaked key space cannot be reversed by hashing a national
  phone-number range. Namespaced per channel, so one number is a *different*
  pseudonym on WhatsApp and USSD, and provider session ids live in a third
  namespace. `+254712345678`, `254712345678`, `0712345678`,
  `254712345678@s.whatsapp.net`, `…:12@s.whatsapp.net` and `…@lid` all
  canonicalize to one pseudonym.
- **Nothing clinical leaves Redis.** Channel sessions carry both a sliding TTL
  and a hard `expiresAt`, so a chatty user cannot keep an ephemeral clinical
  session alive forever. `close`/`funga` deletes immediately.
- **No implicit persistence (§11.3F).** Messaging KKD on WhatsApp never creates
  a health record. When a summary is produced the channel says so explicitly
  (`channel.persistence.notAvailable`): saving requires signing in on the web
  and consenting there.
- **Media is refused, not processed (§11.3E).** Images, voice notes, documents,
  video, stickers, locations, and shared contacts are recognised only so that an
  approved refusal can be sent. The payload is never downloaded, decrypted, or
  forwarded to a third party.
- **Groups are never answered.** A clinical interview only makes sense
  one-to-one, and replying into a group would disclose someone's symptoms to
  third parties. Groups, broadcasts, status, and newsletters are dropped.
- **Cross-channel summary delivery** derives the WhatsApp pseudonym from the
  phone number the aggregator supplied *for that one request* and never persists
  it. The link exists for the duration of the call, and only because the caller
  asked for it. It is offered only when delivery is actually possible.

## Degraded service (§20)

| Failure | Behaviour |
| --- | --- |
| Claude unavailable | interview continues from the reviewed question pathway; the turn is flagged `aiUnavailable` and the patient is told questions may be shorter. Nothing is fabricated. |
| Safety engine error | urgency is **not** guessed. Returns `unknown` + `requiresHumanEscalation`, and the conservative approved message. Never `monitor`, never reassurance. |
| Redis unavailable | no ephemeral clinical session is created, because the TTL and purge guarantees would not hold. `/health/ready` reports degraded. |
| API unreachable from gateway | the gateway stays silent. Only the API may author patient-facing text. |
| Aggregator sends a malformed body | signed-but-malformed → terminal safe screen (`200 END …`), not a `500` an aggregator would show as an error page. |

Safety messaging is always produced in the same synchronous response. Nothing
safety-critical waits on a queue.

## Proactive sends — known limitation

`/integrations/whatsapp/outbox` is the plumbing for scheduled check-ins, and the
gateway drains it. But the adapter can only address a pseudonym it has seen an
inbound message from during the current process lifetime. Reaching a patient who
has not written recently would require storing a reversible contact address —
which on this channel is exactly what the consented profile path is for
(§8.4A, §11.3F). Until that lands, a proactive send to an unknown pseudonym
fails loudly as `unknown_recipient` rather than being guessed at.

## Testing

213 tests across `@kkd/integrations` (100), `@kkd/api` (73), `@kkd/i18n` (28),
and `@kkd/whatsapp-gateway` (12). Spec §11.6 coverage:

| §11.6 requirement | Test |
| --- | --- |
| duplicate WhatsApp webhook | `whatsapp.routes.test.ts` — replay is byte-identical, engine not re-run |
| expired session starts disclosure again | `whatsapp.routes.test.ts` — hard-lifetime, Redis-dropped, and superseded-version paths |
| channel language switching | `whatsapp.routes.test.ts`, `state-machine.test.ts` — session id preserved |
| emergency response remains synchronous | `whatsapp.routes.test.ts`, `ussd.routes.test.ts` — same response, `urgent`, `terminal` |
| USSD timeout and restart | `ussd.routes.test.ts` — restarts at disclosure, ignores accumulated input |
| opt-in does not create a health record | `whatsapp.routes.test.ts` — only ephemeral namespaces written |
| malformed/spoofed webhook rejected | `whatsapp.routes.test.ts`, `ussd.routes.test.ts`, `signature.test.ts` |

Plus: identity unlinkability, no phone number anywhere in Redis, no model
wording on safety screens, USSD screen budget per urgency × locale, locale
completeness, a diagnosis-language lint over the locale files, the single-writer
socket lock, and stale-state recovery (a mapping that outlives its engine
session, or a session ended by a red flag, re-discloses instead of erroring).

## Runbook

See [whatsapp-gateway.md](../runbooks/whatsapp-gateway.md) for pairing, rotation,
and staging validation, and
[channel-privacy-data-flow.md](./channel-privacy-data-flow.md) for the
third-party payload policy (§7.4F).
