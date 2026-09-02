# `@kkd/scoring`

Non-diagnostic **System Score** primitives for KKD-RECORDS-001.

A System Score is **not** the probability of a disease. It is four transparent process dimensions:

| Component | Meaning |
| --- | --- |
| `severityReported` | Patient-rated intensity on a 0–10 scale when the patient supplied one. Absent if they did not. |
| `urgencyClass` | Passthrough from Antonia’s safety/severity engine (`emergency` \| `urgent_today` \| `soon` \| `monitor` \| `unknown`). This package does not guess urgency. |
| `completenessPercent` | Share of required interview-pathway fields the patient actually answered. Inferred fields do not count. |
| `trajectory` | Change in comparable patient-rated intensity over time, or `insufficient_data` when fewer than two comparable points exist. |

Algorithm version `kkd.system-score.v1` is immutable. A later version must use a new string; do not change v1 behaviour in place.

`DEFAULT_COMPLETENESS_FIELD_IDS` is a placeholder pathway until Antonia’s question pathways land. Callers should pass the real required/answered field lists when they exist.
