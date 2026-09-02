# `@kkd/pii`

PII detection and redaction for KKD. Identity must be stripped in code before Claude, jobs, webhooks, logs, and analytics — not by prompt instruction.

## Behaviour

- Deterministic detectors cover Kenyan/international phones, email, precise coordinates, national ID/passport-like values with context, account/reference numbers, DOB with context, URL query identifiers, and configurable org IDs.
- Microsoft Presidio Analyzer supplies NER for names and street-address-like locations. KKD talks to Presidio over HTTP (`PRESIDIO_ANALYZER_URL`, default `http://127.0.0.1:5002`).
- Medical measurements (temperature, pain scores, dosages, durations) and body locations are preserved.
- Policies:
  - `log` / `analytics`: irreversible `[REDACTED:type]`. If Presidio is down, continue with deterministic rules only.
  - `ai` / `job` / `webhook`: numbered placeholders, **fail closed** if Presidio is missing or errors.
  - `session_reversible`: `[PERSON_1]`-style placeholders. Store the map in `SessionPlaceholderStore` (in-memory here; Redis+TTL belongs with the session workstream) and delete it on `clearSession`.

## Local Presidio

```bash
docker compose up -d presidio-analyzer
```

## Wiring

```ts
import { createPiiServiceFromEnv } from "@kkd/pii";

const pii = createPiiServiceFromEnv(env);
const redacted = await pii.sanitizeObject(payload, "ai");
```

Inject that `PiiService` into `@kkd/ai` so Claude never sees raw identity fields.
