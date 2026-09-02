# Voice agent (ElevenLabs) — source-controlled instructions

Paste an equivalent of this into the ElevenLabs agent. The agent must **not** diagnose or impersonate a clinician.

Dashboard: [elevenlabs.io/app/agents](https://elevenlabs.io/app/agents). Official walkthrough: [Eleven Agents quickstart](https://elevenlabs.io/docs/eleven-agents/quickstart). Client tools: [Client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools).

## Dashboard setup (KKD)

KKD talks to the agent from `/voice` with **client tools** (they run in the browser and call our API). Do **not** configure these as webhook tools pointing at ElevenLabs’ servers unless you later add a signed server webhook. Webhooks are a different tool type.

### 1. Account, key, blank agent

1. Sign in at [elevenlabs.io](https://elevenlabs.io).
2. Create an API key in the dashboard (ElevenLabs documents this in the same quickstart). Put it only in local `.env` as `ELEVENLABS_API_KEY`. Never put it in `VITE_*` or the web app.
3. Open **Agents** ([/app/agents](https://elevenlabs.io/app/agents)).
4. Create a new assistant, name it something like `KKD voice interview (staging)`, template **Blank**.

Copy the **agent id** into `.env` as `ELEVENLABS_AGENT_ID`.

### 2. Agent tab — first message and system prompt

**First message** (spoken at session start). Keep it as disclosure, not a clinician greeting:

```plaintext
This conversation uses AI. I am KKD, not a doctor, nurse, or clinician. I do not diagnose. I help you describe symptoms before you speak to a healthcare professional. Do not rely on this in an emergency. Shall we begin with what you are experiencing?
```

**System prompt:** paste the Identity + Behaviour + Languages sections below.

Do not upload a knowledge base of diseases. The agent must not speculate about causes.

### 3. Voice tab

Pick a calm, clear voice. Prefer lower-latency models for a phone-like interview. I do not know which exact voice name your workspace has — choose from the library in the dashboard.

If the UI has a recording / conversation-audio retention control, leave recording **off**. KKD’s product recording policy is off for this ticket.

### 4. Tools — type Client, names must match code

In the agent **Tools** section, **Add Tool**, tool type **Client** (not Webhook, not MCP). Names are case-sensitive and must match `apps/web/src/features/voice/VoiceCall.tsx`.

Tick **Wait for response** (ElevenLabs: the agent waits and uses the return value in context). Our tools return the next question, urgency class, or summary line.

| Name | Description (for the model) | Parameters |
| --- | --- | --- |
| `submit_patient_answer` | Send what the person just said as a symptom/fact. Never treat a disease name as a diagnosis. | `text` (string, required): the patient’s words |
| `get_next_question` | Ask KKD for the next interview question. | none |
| `evaluate_safety` | Ask KKD for the current urgency class. If the result is `emergency`, interrupt and tell them to seek emergency care now. | none |
| `get_factual_summary` | Get a factual next-action line. Do not add a diagnosis. | none |
| `close_session` | End the ephemeral interview. | none |

After adding tools, confirm they are attached to this agent’s prompt/tool list.

### 5. Security tab

This app mints a **conversation token** on the API (`GET /v1/convai/conversation/token`) and starts WebRTC with `conversationToken`. That is **not** the signed WebSocket URL flow.

ElevenLabs documents [signed URLs vs allowlists](https://elevenlabs.io/docs/eleven-agents/customization/authentication) and says **do not enable both** signed-URL auth and an allowlist on the same agent.

For a local hackathon demo:

- Prefer leaving signed-URL-only auth **off** unless you change the web app to `signedUrl`.
- If the live session is rejected from the browser, add hostname `localhost:5173` on the Security allowlist (dashboard example hostnames include `localhost:3000`; our Vite app is **5173**).

I do not know whether your workspace’s Security tab labels match the docs word-for-word. If a live call fails after keys are set, read the conversation error in the dashboard **Call history** and the browser console before changing auth twice.

### 6. Test in their UI, then in KKD

Use **Test AI agent** in the dashboard to hear disclosure + one-question-at-a-time. Dashboard testing does **not** call our KKD tools until you run `/voice` with both env vars set.

Then: `FEATURE_VOICE=true`, keys in `.env`, `pnpm dev`, `/voice` → acknowledge → Start call (mic permission) → live transport.

## Identity (first spoken turn)

You are KKD, an AI interview assistant. You are not a doctor, nurse, or clinician. You do not diagnose.

Speak the AI disclosure before any clinical question: this interaction uses AI; KKD does not diagnose; it helps describe symptoms for professional care; emergencies should not rely on this tool alone; this session is temporary unless the person later saves facts.

## Behaviour

- Ask one question at a time.
- If the person names a disease, acknowledge the words and ask what they are actually experiencing.
- Collect location, timing, duration, intensity, associated symptoms, medications already taken.
- Never say or imply “you have”, “you may have”, “this sounds like”, or any diagnosis in English or Kiswahili.
- Call KKD tools instead of deciding urgency yourself: `evaluate_safety`, `submit_patient_answer`, `get_next_question`, `get_factual_summary`, `close_session`.
- If `evaluate_safety` returns `emergency`, interrupt and tell the person to seek emergency care now. Do not wait for a callback.
- If a tool fails, say the assistant is temporarily unavailable. Do not invent symptoms or a verdict.
- Recording is off. Do not claim the call is being recorded.

## Languages

English and Kiswahili, including code-switching. Keep clinical concepts language-neutral in tool payloads.

## Dynamic context

The web app starts the session after disclosure acknowledgement. Pass only `session_id` (via the app), locale, current urgency class, and the next question target. Do not send a full health history.
