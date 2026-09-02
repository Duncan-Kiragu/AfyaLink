# Voice (KKD-VOICE-001)

Browser ElevenLabs Conversational AI plus a mocked handset. Twilio/SIP are not used in this ticket.

## Local demo

1. Copy `.env.example` to `.env` (or export `FEATURE_VOICE=true`). The schema default for the flag is still `false`.
2. Leave `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` empty for the typed mock handset at `/voice`.
3. Paste those two values when you want a live WebRTC session. The API key never leaves the API process; the browser only receives a short-lived conversation token.
4. `pnpm dev`, open `/voice`, acknowledge disclosure, start the mock call, submit two answers, show the factual summary.

## Privacy

- Call recording is off and is not configurable in this ticket.
- Logs must not include transcripts, phone numbers, or summaries. Jobs may carry a structured factual summary for mock SMS, never raw audio. Only `phoneLast4` is stored on the job payload.
- Ephemeral voice sessions live in API memory for this ticket. Replace with Redis (`kkd:session:{id}`) when bootstrap lands.
- Kiswahili UI strings and diagnosis-guard phrases are unreviewed placeholders.

## Failure

- Missing ElevenLabs credentials → mock browser interview (typed answers), not a fake successful live call.
- Live start failure (mic / WebRTC) → stay on the mock typed interview.
- Redis/BullMQ down, or `NODE_ENV=test` → in-process mock delivery. The user path does not fail closed for SMS/callback *offers*.
- Safety timeout/unavailable → conservative `unknown` / emergency banner from the stub rules (`voice-stub.v0`), not an LLM guess. This stub is temporary; it is not Antonia’s clinical-safety engine.

## Nearby hospital, SMS, callback

Those are **offers** after the summary:

- Provider search is Hassan’s workstream. Voice only links to `/care-near-me`.
- SMS is mocked (`summary_sms` on queue `voice-callbacks`).
- “Call me back to continue this interview” is an interview continuation, not a clinician transfer. `POST /api/v1/voice/callback/cancel` cancels it.
- Clinician/pharmacist handoff is out of this ticket.
