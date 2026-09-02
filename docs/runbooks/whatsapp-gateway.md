# Runbook — WhatsApp gateway and USSD channel

Owner: Noordin. Covers pairing, rotation, staging validation, and the failure
modes an on-call engineer will actually hit.

## Prerequisites

```
CHANNEL_IDENTITY_SALT      # >= 32 chars, same value for API and gateway
WHATSAPP_GATEWAY_SECRET    # >= 32 chars, same value for API and gateway
WHATSAPP_AUTH_SLOT         # distinct per environment (e.g. "stage", "prod")
USSD_CALLBACK_SECRET       # >= 32 chars, shared with the aggregator
REDIS_URL                  # same instance for API and gateway
FEATURE_WHATSAPP / FEATURE_USSD
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Enabling `FEATURE_WHATSAPP` or `FEATURE_USSD` without its secrets **fails at
boot** rather than starting an unauthenticated channel. That is deliberate.

`WHATSAPP_AUTH_SLOT` must differ between staging and production. Sharing a slot
means sharing one WhatsApp linked-device session, and the two environments would
log each other out.

## First-time pairing (QR)

1. Deploy `kkd-whatsapp-*` with the variables above and `FEATURE_WHATSAPP=true`.
2. Watch the logs. With no stored session you will see:
   `whatsapp_pairing_required` followed by a QR block.
3. On the **operator phone**: WhatsApp → Settings → Linked devices → Link a
   device → scan.
4. Expect `whatsapp_connected` and `whatsapp_status status=open`.
5. Credentials are now in `kkd:channel:whatsapp:auth:{slot}`. Redeploys reuse
   them; no re-pairing.

The QR authorizes a device. It is not patient data, but it is a credential —
anyone who scans it before you gains the session. Treat the log window as
sensitive and re-deploy to invalidate an unscanned QR.

## Operator phone hygiene

The operator account is a real WhatsApp account. Whoever holds that phone can
read every patient conversation. This is not enforceable in code:

- dedicated device, screen lock, full-disk encryption;
- **WhatsApp chat backup disabled** (a cloud backup copies patient conversations
  outside KKD's control);
- no other linked devices on that account;
- device custody logged; removal from the estate follows the credential
  rotation procedure below.

## Local development

```bash
# Terminal 1
docker run -p 6379:6379 redis:7-alpine
# Terminal 2
pnpm --filter @kkd/api dev
# Terminal 3
pnpm --filter @kkd/whatsapp-gateway dev   # prints the QR
```

Use a **test WhatsApp number**, never a number that receives real patient
traffic.

## Staging validation (§11.5 "end-to-end staging test numbers")

### WhatsApp

1. Message the operator number from a test handset. Expect the AI disclosure and
   nothing clinical.
2. Send a symptom description *without* acknowledging. Expect
   `channel.disclosure.required` — the interview must not start.
3. Reply `1`. Expect the first question.
4. Send `LANG`, then `2`. Expect a Kiswahili confirmation and the question
   re-asked in Kiswahili, with the session id unchanged in Redis.
5. Send an image. Expect the refusal; confirm no media file was written anywhere
   and no download appears in the logs.
6. Send `close`. Confirm `kkd:session:*` and the identity key are gone:
   ```bash
   redis-cli --scan --pattern 'kkd:session:*'
   redis-cli --scan --pattern 'kkd:channel:whatsapp:identity:*'
   ```
7. Grep the logs for the test number and for any message body. Both must be
   absent.

### USSD

Point the Africa's Talking sandbox service code at
`POST /api/v1/integrations/ussd` with the shared secret configured, then dial the
sandbox code and confirm:

1. Screen 1 is the compressed bilingual disclosure with the language menu.
2. Option 3 ends the session without starting an interview.
3. Options 1/2 advance to the symptom-category menu in the chosen language.
4. `0` on any conversation screen re-offers the language menu without submitting
   a clinical answer.
5. No screen exceeds 182 characters and no screen ends in `…`.
6. After the terminal screen, `kkd:channel:ussd:state:*` is empty.

Aggregator retry check: replay the identical callback (same `sessionId`, same
`text`). The response must be **byte-identical** and the dialogue must not
advance.

## Failure modes

| Symptom | Cause | Action |
| --- | --- | --- |
| `whatsapp_socket_lock_busy`, stays idle | another instance holds the socket | Expected on a scaled service. Scale `kkd-whatsapp-*` to **1**. |
| `whatsapp_socket_lock_lost`, process exits 1 | lock taken over, or Redis outage past the TTL | Self-healing: Render restarts it into standby. If it flaps, check Redis latency and that only one instance is running. |
| `whatsapp_logged_out` | operator unlinked the device, or WhatsApp invalidated the session | Credentials are cleared automatically. Re-pair (see above). |
| `whatsapp_reconnect_scheduled` repeating | network or WhatsApp edge issue | Backoff is exponential with full jitter, capped at 60s. If it persists past ~15 min, check whether the number was banned. |
| `whatsapp_inbound_forward_failed` | gateway cannot reach the API | Patients get **no reply** — by design, since only the API may author patient-facing text. Check `API_BASE_URL` and API health. |
| `channel_signature_rejected status=signature_mismatch` | secret mismatch between gateway and API | Confirm `WHATSAPP_GATEWAY_SECRET` is identical in both services. |
| `channel_signature_rejected status=stale_timestamp` | clock skew > 5 min | Check host clocks. |
| `channel_unavailable` (503) | flag on, secret missing | Set the secret or turn the flag off. |
| `whatsapp_outbox_undelivered status=unknown_recipient` | proactive send to a pseudonym with no live inbound | Known limitation — see the "Proactive sends" section in [channels.md](../architecture/channels.md). |
| USSD callers see an aggregator error page | the route returned non-200 | It should not: malformed and failed callbacks return `200 END …`. Check for a crash before the handler. |

## Credential rotation

### `WHATSAPP_GATEWAY_SECRET` / `USSD_CALLBACK_SECRET`

Both sides validate a single secret, so rotation is a brief coordinated
restart. Rotate at a low-traffic window:

1. Set the new value on the API, then on the gateway (or in the aggregator
   console for USSD).
2. Restart both.
3. In-flight callbacks during the gap are rejected `401`; the gateway retries
   and aggregators re-POST, so the impact is a few seconds of delay.

### `CHANNEL_IDENTITY_SALT`

Rotating this changes every pseudonym, orphaning in-flight channel sessions.
They are ephemeral, so this is acceptable — but users mid-conversation will be
re-disclosed and start over. Do it deliberately, not casually, and purge the
stale keys afterwards:

```bash
redis-cli --scan --pattern 'kkd:channel:*:identity:*' | xargs -r redis-cli del
redis-cli --scan --pattern 'kkd:channel:ussd:state:*'  | xargs -r redis-cli del
```

Do **not** delete `kkd:channel:whatsapp:auth:*` — that is the account session,
not a pseudonym, and deleting it forces a re-pair.

### Operator phone compromise / decommission

1. On any WhatsApp client for that account: Linked devices → remove the KKD
   device. This invalidates the session immediately.
2. Delete the stored credentials:
   ```bash
   redis-cli del kkd:channel:whatsapp:auth:{slot}
   ```
3. Purge live channel state (the identity/state patterns above).
4. Re-pair from a clean device.

Note that step 1 does not delete messages already on the compromised device.
Escalate to incident response, not just rotation.

## Rollback

Both channels are behind flags with no schema to migrate:

```
FEATURE_WHATSAPP=false   # gateway exits 0 on boot; API returns 404 channel_disabled
FEATURE_USSD=false       # API returns 404 channel_disabled
```

Turning a flag off does not purge existing ephemeral state — it expires on its
own TTL. To purge immediately, use the patterns above. The stored WhatsApp
credentials survive a flag flip, so re-enabling does not require re-pairing.

Rolling back the gateway to a previous image is safe: the Redis auth-state
format is versioned only by Baileys' own `BufferJSON` encoding. A **Baileys
major upgrade** is the case that needs care — v7 added `lid-mapping`,
`device-list`, and `tctoken` key types to the auth state, so downgrading below
the version that wrote the session may require a re-pair. Baileys is currently
pinned to a `7.0.0-rc` release (the registry `latest` tag, and the only
ESM-only line); revisit the pin when 7.0.0 final ships.
