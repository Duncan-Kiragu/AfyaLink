# Channel privacy data flow (WhatsApp + USSD)

Third-party payload policy for the channel adapters, per spec §7.4F. Owner:
Noordin. Reviewers: Evans (PII/data map), Antonia (safety wording).

## Provider: WhatsApp, via Baileys (`baileys@7.x`)

Baileys is a client library, not a hosted service — it speaks the WhatsApp Web
multi-device protocol directly. The third party receiving data is **WhatsApp /
Meta**, exactly as it would be for any WhatsApp conversation.

| Question | Answer |
| --- | --- |
| Fields sent | The message body KKD authors, addressed to the patient's own WhatsApp number. |
| Why necessary | It is the message the patient asked for. There is no way to deliver a WhatsApp reply without WhatsApp receiving it. |
| Is PII redacted? | No, and it must not be: the recipient is the data subject. KKD's own output contains no third-party identifiers. |
| Raw health content? | Yes — necessarily. The patient's symptom description and the factual summary transit WhatsApp, end-to-end encrypted between the operator device session and the patient. |
| Retention | Governed by WhatsApp/Meta and by the patient's own device. **KKD cannot delete a delivered WhatsApp message.** This must be stated in the patient-facing privacy notice. |
| Deletion/expiry | Not available to KKD. The disclosure tells the patient the chat is temporary *on KKD's side*; their own chat history persists on their device. |
| Inbound media | Never downloaded or decrypted. Recognised only to send an approved refusal (`channel.media.unsupported`). |
| Chat history | `syncFullHistory: false`. KKD never imports the operator account's unrelated conversations. |
| Presence | `markOnlineOnConnect: false`. |
| Groups | Group, broadcast, status, and newsletter JIDs are dropped without reply, so a person's symptoms are never disclosed to third parties. |

**Residual risk to record explicitly:** WhatsApp is not a KKD-controlled
channel. The operator account is a real WhatsApp account on a real device;
whoever holds that device can read every conversation. This is an operational
control (device custody, screen lock, no cloud chat backup), not a code control.

## Provider: Africa's Talking (USSD)

| Question | Answer |
| --- | --- |
| Fields sent | The screen body only (`CON …` / `END …`). |
| Fields received | `sessionId`, `phoneNumber`, `text`, `serviceCode`, `networkCode`. |
| Why necessary | The aggregator's callback contract. `phoneNumber` is how the network identifies the caller and cannot be suppressed. |
| Is PII redacted? | The inbound `phoneNumber` and `sessionId` are hashed at the API boundary and never stored, logged, or forwarded in raw form. Verified by test: no digit of the number appears anywhere in Redis. |
| Raw health content? | Yes — the screen text is a symptom question or an urgency message, and USSD is unencrypted over the network by design. The disclosure states the session is temporary. |
| Retention | Aggregator-side session logs are outside KKD's control. KKD-side dialogue state has a 180-second TTL and is deleted on the terminal screen. |
| Deletion/expiry | KKD-side: immediate on `END`, otherwise TTL. Aggregator-side: per their contract. |

**Residual risk:** USSD has no transport encryption. It is therefore only used
for short structured questions and deterministic urgency guidance, never for the
factual handover summary — which is why the summary is offered on another
channel instead (§11.4B).

## Provider: Claude (via `@kkd/ai`)

Unchanged by this workstream. The channel adapters call the shared conversation
engine, which is the only component that talks to Claude, and it routes free
text through the PII controls Evans owns (§4.3F). Channels add no direct
third-party AI call.

## Data KKD stores for these channels

| Key | Contents | TTL | Classification |
| --- | --- | --- | --- |
| `kkd:session:{id}` | ephemeral clinical session (facts, safety, answers) | `EPHEMERAL_SESSION_TTL_SECONDS`, hard cap `SESSION_MAX_LIFETIME_SECONDS` | health data |
| `kkd:channel:{ch}:identity:{hash}` | pseudonym → session id, locale, disclosure version | `CHANNEL_SESSION_TTL_SECONDS`, hard cap | pseudonymous linkage |
| `kkd:channel:ussd:state:{hash}` | dialogue step, pending choices, screen count | `USSD_SESSION_TTL_SECONDS` (180s) | pseudonymous + minimal health context |
| `kkd:channel:{ch}:idem:{id}` | memoised response for replay | `CHANNEL_SESSION_TTL_SECONDS` | health data (the reply text) |
| `kkd:channel:whatsapp:auth:{slot}` | Baileys account credentials + Signal keys | **none** | **secret / credential** |
| `kkd:lock:channel:whatsapp:socket` | owner id | 30s | operational |
| `kkd:channel:whatsapp:outbox` | queued proactive messages | none (drained) | health data |

Nothing in this table is written to Supabase. Nothing here is written to normal
application logs.

The auth hash is the one entry with no TTL, because expiring it would log the
operator number out of WhatsApp. It is a credential and belongs in the
credential-rotation runbook, not the health-data purge job.

## What is logged

Safe metadata only, per §18: `event`, `channel`, `sessionMode`, `language`,
`urgency`, `promptVersion`, `status`, `latencyMs`, `requestId`. The observability
logger drops any field outside that allowlist.

Never logged: message bodies, phone numbers, JIDs, provider session ids,
webhook/callback bodies, summaries, signatures, Baileys credentials. Signature
rejections log a reason code (`signature_mismatch`, `stale_timestamp`, …) and
nothing else. Errors log the class name, never the message, because an error
message can quote patient text.

Baileys' own logger is pinned to `warn` outside local development: its
`trace`/`debug` output includes message contents.
