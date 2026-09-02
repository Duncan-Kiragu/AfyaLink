# ADR-002: Presidio Analyzer plus deterministic KKD detectors

## Status

Accepted

## Context

KKD must minimise identity exposure while keeping clinically relevant symptom facts. Logging safety cannot depend on an LLM. Names and addresses need NER where regex is insufficient. The runtime is TypeScript.

## Decision

- Run official Presidio Analyzer as a sidecar (`ghcr.io/data-privacy-stack/presidio-analyzer`) and call `/analyze` from `@kkd/pii`.
- Keep structured PII (phone, email, coordinates, IDs, URL query params) in a tested TypeScript detector. Send Kenyan phone/ID patterns to Presidio as ad-hoc recognizers as well.
- Anonymize in TypeScript so policies, medical-preservation filters, and reversible session placeholders stay in one place. Do not take a dependency on the Presidio Anonymizer service.
- Fail closed on `ai`, `job`, `webhook`, and `session_reversible` if Analyzer is unavailable. Logs stay deny-by-default plus deterministic redaction.

## Consequences

- Staging/production need `PRESIDIO_ANALYZER_URL`.
- Name detection quality follows the English spaCy model shipped with Presidio; Kiswahili introductions are also covered by a deterministic "jina langu ni" rule.
- Session placeholder persistence in Redis is an integration point for the session workstream, not a second PII engine.
