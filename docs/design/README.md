# Design — Symptom Assessment flow

Visual reference for the patient-facing symptom assessment journey. This is a
**design artefact, not application code** — nothing here is imported by any
package. Treat it as the source of truth for layout, copy and colour until the
equivalent primitives land in `packages/ui`.

## Contents

| File | What it is |
| --- | --- |
| `symptom-assessment.dc.html` | The flow: symptom entry, follow-up questions, triage verdict, nearby care, USSD screen, WhatsApp thread, follow-up check-in |
| `support.js` | Canvas runtime the HTML needs to render. Do not edit by hand |
| `assets/afyalink-ink.svg` | AfyaLink logo, dark ink version |
| `assets/afyalink-light.svg` | AfyaLink logo, light version |

## Viewing it

Open `symptom-assessment.dc.html` in a browser directly — no build step, no
dependencies beyond Google Fonts.

## Notes for implementers

- The `NOT A DIAGNOSIS` banner is fixed at the top of every screen. It reflects
  the AI disclosure requirement in `docs/requirements/` and must survive into
  the built UI.
- Palette: `#EDEFF3` background, `#171A1F` ink, `#1D4E89` primary, `#C2571A`
  accent/urgency.
- Type: Bricolage Grotesque (headings), Inter (body), JetBrains Mono (labels).
- Screens are illustrative. Real copy for clinical states must be checked
  against `docs/clinical-rules/` before implementation.
