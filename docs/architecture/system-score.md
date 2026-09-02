# System Score meaning

Owned by Workstream 2. The score is **not** a disease probability and must never be presented as one.

`urgencyClass` uses the shared safety contract (`emergency`, `urgent_today`, `soon`, `monitor`, `unknown`). Section 6.3 of the requirements draft wrote `urgent`; the implemented value is `urgent_today` so every workstream shares one enum.

See `packages/scoring/README.md` for component definitions and algorithm version `kkd.system-score.v1`.
