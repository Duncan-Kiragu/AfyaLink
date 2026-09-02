# WS4 Plan — Severity + Health Profiling (Antonia)

**Scope:** Workstream 4, spec §8. Secondary: co-owned Workstream 9 (MCP), spec §13.
**Ticket:** KKD-SAFETY-001 (§28). MCP ticket: KKD-MCP-001 (§33).
**Status:** Slices 1-7 and 9 implemented. Slice 8 deferred to Phase 2 (see §5 issue H). Slice 10 (MCP) not started.
**Spec:** `docs/requirements/kkd-requirements-spec.md` v0.2, 2 September 2026.

> **Numbering note.** The brief called the MCP Interface "section 24". In the spec, MCP Interface
> is **§13** (Workstream 9); the division of work between Evans and me is **§13.5**, and the first
> MCP ticket is **§33**. **§24** is the *Owner Handoff Checklist* — which does apply to me, but as a
> merge gate, not as a workstream. Both are covered below.

---

## 1. Deliverables assigned to me by §8

Each item quotes the spec line that assigns it.

### 1.1 Severity contracts

- [ ] **`UrgencyClass` enum**
  §8.2: *"Use a small, clinically reviewed disposition enum"* — `emergency | urgent_today | soon | monitor | unknown`.
  *Already exists* in `packages/contracts/src/safety.ts` (`urgencyClassSchema`). Nothing to add; see §5 issue A for a value mismatch with §6.3.D.

- [ ] **`SafetyAssessment` output contract**
  §8.2: fields `urgency`, `ruleIds`, `explanationKeys`, `missingCriticalFacts`, `requiresHumanEscalation`, `ruleSetVersion`.
  *Already exists* in `packages/contracts/src/safety.ts` (`safetyAssessmentSchema`). Semantics of `requiresHumanEscalation` are undefined — see §5 issue D.

- [ ] **Severity evaluation *input* contract** — *not specified anywhere in the spec; I must define it.*
  Implied by §19 `POST /api/v1/severity/evaluate` and by the current stub `SafetyEngine.evaluate(session: unknown)` in `packages/clinical-safety/src/index.ts`. See §5 issue C.

### 1.2 Deterministic rule engine — §8.3.A

- [ ] **Versioned rule definitions**
  §8.3.A: *"Build versioned rule definitions in `packages/clinical-safety`. A rule should contain: id, version, status, required inputs, conditions, urgency result, patient message key, clinical rationale/source metadata, reviewed_by, reviewed_at"*

- [ ] **Rule runner that owns the final urgency decision**
  §8.3.A: *"Do not let Claude directly return the final urgency class without the rule engine checking/deciding it."*
  Reinforced by §6.3.D: *"urgency comes from Antonia's safety/severity engine, not from an LLM guess"*.
  **This is currently violated by existing scaffolding** — see §5 issue B.

- [ ] **Deterministic replay**
  §8.6: *"deterministic same-input/same-rule-version behavior"*
  §8.7: *"every decision identifies rule IDs/version internally"*

### 1.3 Red-flag-first execution — §8.3.B

- [ ] §8.3.B, *"After every patient message:"*
  1. *"normalize explicit facts"* (consumes Evans's `@kkd/ai` output — I do not own normalization)
  2. *"run known critical rules immediately"*
  3. *"if a critical threshold is met, return the approved safety message before continuing optional questioning"*
  4. *"if not, identify critical missing facts for the current complaint pathway"*
  5. *"ask those questions before lower-value detail questions"*

- [ ] **Ordering immunity test**
  §8.6: *"red flags cannot be bypassed by conversation ordering"*

### 1.4 Unknown state — §8.3.C

- [ ] §8.3.C: *"If required information cannot be established, return `unknown` rather than creating false reassurance."*
- [ ] §8.6: *"missing critical fact returns `unknown` or asks a required question"*

### 1.5 "Can I wait until tomorrow?" behaviour — §8.3.D

- [ ] **Action-phrased dispositions, not condition-phrased**
  §8.3.D: *"The system should answer in action terms, for example: 'Based on what you have reported, the safest next step is to be assessed today.'"*
  and *"'No urgent warning sign has been identified from the information collected so far. Continue monitoring and seek professional care sooner if the listed warning signs appear.'"*
- [ ] §8.3.D: *"All exact wording requires clinical review."* — **blocked**, see §5 issue F.
- [ ] §8.3.D: *"Never say: 'You probably have X, so you can wait.'"*

### 1.6 Health profiling — explicit consent — §8.4.A

- [x] §8.4.A, *"Before the first persistent check-in:"*
  - *"show what will be stored"*
  - *"show how often KKD will contact the user"*
  - *"allow channel selection"*
  - *"record consent version"*
  - *"allow withdrawal"*
- [x] §8.7: *"profile data exists only after explicit consent"*
- [x] §8.6: *"consent withdrawal stops future check-ins"*; §8.7: *"follow-ups stop after consent withdrawal"*

### 1.7 Follow-up schedules — §8.4.B

- [x] §8.4.B: *"Support: daily / weekly / custom future check-in"*
- [x] §8.4.B: *"Store schedules in Supabase and enqueue/check due work through BullMQ."*
- [x] §8.4.B: *"Do not create one endlessly delayed job that cannot be audited; store the source schedule persistently and create delivery jobs from it."*
  → schedule is the source of truth in Postgres (`follow_up_schedules`). V1 derives due
  *occurrences* from it on read rather than enqueuing delivery jobs: there is no delivery
  channel to enqueue for (see §5 issue H). Occurrence ids are stable and derived, so the
  Phase 2 processor produces the same ones.

### 1.8 Check-in templates — §8.4.C

- [x] §8.4.C: *"Each check-in should be based on previously reported facts, not a disease label."*
  Examples given: *"Yesterday you rated the abdominal pain 6/10. What is it now?"*, *"Have you vomited since the last check-in?"*, *"Are you able to drink fluids?"*

### 1.9 Trends — §8.4.D

- [x] §8.4.D allowed: *"Your reported pain scores have decreased from 7 to 4 over three check-ins."* / *"You reported fever on four of the last five check-ins."* / *"This symptom has been marked as worsening for two consecutive check-ins."*
- [x] §8.4.D prohibited: *"This pattern means you have malaria."* / *"Your likelihood of X is increasing."*
- [x] §8.7: *"trends are factual and non-diagnostic"*

### 1.10 Escalation from profile — §8.4.E

- [x] §8.4.E: *"Every new check-in must run the same severity engine."*
- [x] §8.4.E: *"A profile cannot suppress a new red flag merely because earlier check-ins were low urgency."*
- [x] §8.6: *"worsening follow-up can trigger a higher urgency"*

### 1.11 Synchronous execution guarantee

- [ ] §8.7: *"safety-critical execution is synchronous"*
- [ ] §2.1: *"Do not put immediate safety/seriousness evaluation in a queue. Anything that determines what the current user should do must run synchronously."*
  Already encoded in `docs/architecture/conventions.md`: *"Safety/urgency evaluation is not a job. It runs synchronously in the API."*

### 1.12 Tests I own — §8.6 (all six) and §21.1

- [ ] red flags cannot be bypassed by conversation ordering
- [ ] missing critical fact returns `unknown` or asks a required question
- [ ] deterministic same-input/same-rule-version behavior
- [x] worsening follow-up can trigger a higher urgency
- [x] no diagnostic language in severity or trend statements
- [x] consent withdrawal stops future check-ins
- [ ] §21.1 also names **severity rules**, **trend calculations**, and **consent rules** as unit-test surfaces I own.

### 1.13 Obligations §8 does not list but other sections put on me

- [ ] **Urgency + longitudinal outputs to Duncan.** §6.4: *"Antonia: urgency class and longitudinal profiling outputs."*
- [ ] **Diagnosis-language guard localization.** §10.4.D: *"Work with Evans/Antonia to maintain prohibited semantic patterns and regression examples in each supported language. A literal phrase list is not enough; test paraphrases and code switching."* See §5 issue E for ownership.
- [ ] **Safety-engine failure behaviour.** §20: *"Safety engine error | Conservative approved failure response; direct to professional care where appropriate; emit critical operational alert."*
- [ ] **Observability.** §18 tracks *"safety-rule failures"* as a metric; §18 forbids raw symptom text. Safe event fields are already constrained by `assertSafeEvent` in `@kkd/observability` (which permits `urgency` and `ruleId`).
- [ ] **AI regression assertions.** §21.3 requires each case to assert *"urgency comes from approved rule path"* and *"required red-flag question is not skipped"* — my rules are what those assertions test.
- [ ] **§24 handoff checklist**, before merge: implementation README, `.env.example` entries, Zod contracts, migrations, unit tests, integration tests, privacy data-flow note, failure modes, staging validation steps, observability events/metrics, rollback notes.
- [ ] **§22 Definition of Done** applies in full.

### 1.14 WS9 / MCP share — §13.5

- [ ] §13.5: *"**Antonia:** safety semantics, tool descriptions around urgency/profile behavior, consent boundaries, clinical regression tests."*
  (Evans takes *"MCP transport, auth/scopes, shared service wiring, PII/logging, deployment."*)
- [ ] §13.4.E: safety enforcement chain — *"shared contracts -> PII policy -> session service -> safety engine -> diagnosis-language output guard"*, and *"The MCP client cannot pass `skipSafety=true`, `returnDiagnosis=true`, or equivalent flags."*
- [ ] §13.4.F annotations for my tools: *"`create_followup_schedule` writes persistent data and requires consent"*.
- [ ] §13.3: there must be **no** `kkd.diagnose`, `kkd.differential_diagnosis`, `kkd.predict_disease`.
- [ ] §13.6 tests: *"tool calls cannot bypass severity rules"*, *"profile-write tool rejects absent consent/authentication"*.
- [ ] **Phase gate** — §23 Phase 3: MCP comes *"after session, PII, severity, and consent contracts are working."* MCP is last.

---

## 2. Package placement — what already exists

Checked against the working tree, not assumed.

### `packages/clinical-safety` — **mine** (`conventions.md` ownership table: *"`packages/clinical-safety`, profiling | Antonia | KKD-SAFETY-001"*)

Current contents (`src/index.ts`, ~30 lines, scaffold only):

| Exists | State | My action |
| --- | --- | --- |
| `safetyRuleSchema` | Zod object, **missing the `conditions` field** required by §8.3.A; `urgencyResult` typed `z.string()` not `urgencyClassSchema` | Fix both. Add `conditions`, tighten `urgencyResult`, make `reviewedBy`/`reviewedAt` required for `status: "active"` |
| `DiagnosisLanguageGuard` interface | declared, no implementation | Implement (ownership caveat — §5 issue E) |
| `SafetyEngine` interface | `evaluate(session: unknown)` — untyped input | Replace `unknown` with a real input contract (§5 issue C) |
| `UnimplementedSafetyEngine` | rejects with an error | Replace with the real engine |

Everything else in this package is mine to create: rule registry/loader, rule-set version pinning, red-flag-first evaluator, complaint-pathway required-field definitions, unknown-state resolution, check-in template selection, trend calculation.

Package deps already correct: `@kkd/contracts` + `zod`, Vitest configured (`vitest run --passWithNoTests`).

### `packages/contracts` — **Evans's package, I contribute schemas by PR**

`conventions.md`: *"Import `@kkd/contracts`, never copy types into an app."* Anything crossing a package/app boundary goes here.

Already present and usable as-is:

- `safety.ts` — `urgencyClassSchema`, `safetyAssessmentSchema`, `assessmentCompletenessSchema` ✅
- `symptoms.ts` — `reportedSymptomSchema`, `reportedFactSchema`, `measurementSchema`, `factConfidenceSchema`, `summaryBucketSchema` ✅ (the §5.1/§5.2 contracts my rules read)
- `session.ts` — `kkdSessionSchema` with `safety` and `completion` fields ✅
- `scores.ts` — `trajectorySchema`, `systemScoreSnapshotSchema` ✅ (Duncan's, imports my `urgencyClassSchema`)
- `jobs.ts` — `QUEUE_NAMES` includes `followups`, `jobEnvelopeSchema` with `idempotencyKey` ✅
- `mcp.ts` — `MCP_TOOL_NAMES` and `MCP_SCOPES` including `safety:evaluate`, `profile:write`, `followup:create` ✅
- `api.ts` — `apiV1.severityEvaluate`, `apiV1.profileFollowups` ✅

**Missing — I must add:**

- `severityEvaluationInputSchema` (nothing exists for this)
- `followUpScheduleSchema` — cadence `daily | weekly | custom`, next-due, active/withdrawn state
- `checkInSchema` — prompt, expected answer shape, source facts referenced
- `checkInConsentSchema` — consent version, channel selection, contact frequency shown
- `trendStatementSchema` — factual statement + the observations it was derived from
- `followupJobPayloadSchema` — the delivery job derived from a schedule (§8.4.B)

Where a type is internal to the rule engine (rule definition files, pathway tables), it stays in `clinical-safety` and is **not** exported to contracts.

### `packages/scoring` — **Duncan's** (`conventions.md`: *"`packages/scoring`, `apps/api/src/modules/records`, `supabase` record tables | Duncan"*)

Current contents: `ScoreEngine` interface + `UnimplementedScoreEngine`. **I write nothing here.** I am an input to it: §6.3.D says the snapshot's `urgencyClass` comes from my engine. Contract handshake with Duncan, no shared code.

### Other paths I will touch

| Path | Owner per `conventions.md` | What I do |
| --- | --- | --- |
| `apps/api/src/modules/severity/` | **unassigned** — I claim it | Implement `POST /api/v1/severity/evaluate` (currently a 501 stub) |
| `apps/api/src/modules/profiles/` | **unassigned** — I claim it | Implement `POST`/`DELETE /api/v1/profile/followups` (currently 501 stubs) |
| `apps/worker/src/processors/followups.ts` | app is Evans's, processor body is mine | Implement due-schedule → delivery job. Currently `throw new Error(...)` |
| `packages/testing/src/regression/` | shared | Add clinical regression cases. Folders `red-flags`, `missing-critical-data`, `ambiguous`, `code-switching` already declared |
| `docs/clinical-rules/` | mine | Rule sources + review notes. README already says: *"Versioned rule sources and review notes for `packages/clinical-safety`."* |
| `packages/i18n/src/locales/{en,sw}.json` | **Brian's** | I supply `explanationKeys`; he supplies reviewed strings. Only `urgency.emergency` exists today |
| `supabase/migrations/` | Duncan for record tables; **`follow_up_schedules` unassigned** | See §5 issue G |
| `apps/mcp/` | Evans + me | Tool descriptions, safety semantics, consent boundaries (§13.5). Server currently registers all 10 tools as `isError: true` stubs |

---

## 3. Dependencies on other owners

### 3.1 On Evans — session / AI / PII platform

| I need | Spec | Current state | Blocks |
| --- | --- | --- | --- |
| Redis session service (`POST /api/v1/sessions`, `GET/:id`, close) | §4.E, §19 | 501 stub in `sessions.routes.ts` | Session-backed severity evaluation, writing `KkdSession.safety` back, §8.3.B step 3 ("return the safety message before continuing") |
| `@kkd/ai.extractReportedFacts` returning schema-valid `ReportedFacts` | §4.F | `UnimplementedAiService` rejects | End-to-end demo only. **Not** the rule engine — I take *normalized facts* as input, not free text |
| `@kkd/ai.planNextQuestion` | §4.F | Unimplemented | Phrasing of my required questions. I own *which* question; Evans's service owns *wording* |
| `@kkd/pii` | §7 | `UnimplementedPiiService` rejects | Nothing in the deterministic engine (no free text leaves it). Blocks end-to-end + MCP §13.4.E |
| AI disclosure service | §4.J, §15 | `aiDisclosureSchema` exists; no service | MCP §13.4.D disclosure gate |
| Contracts PR review/merge | §4 | active | All my cross-boundary schemas |
| MCP transport, auth, scopes | §13.5 | `apps/mcp` stubs only | All of WS9 |
| A "critical operational alert" primitive | §20 | **Gap** — `@kkd/observability` has a pino logger and `assertSafeEvent`, no alerting | §20 safety-engine-error behaviour. I will raise this with Evans |

### 3.2 On Duncan — persistent health record layer

| I need | Spec | Blocks |
| --- | --- | --- |
| `health_records` / `health_record_entries` tables + RLS | §6.3.A | Storing check-in answers |
| `HealthRecordService.appendEntry` / `listEntries` | §6.3.B | Writing check-in results; reading history for trends |
| Consent record + current consent version | §6.3.C | §8.4.A consent gate, §8.7 *"profile data exists only after explicit consent"* |
| Comparable longitudinal entries | §6.3.D *"trajectory requires comparable longitudinal entries"* | §8.4.D trends, §8.6 *"worsening follow-up can trigger a higher urgency"* |

**Reverse dependency:** §6.4 lists me as Duncan's dependency (*"Antonia: urgency class and longitudinal profiling outputs"*). We are mutually blocking at the contract level, so **the contract handshake must happen before either of us builds storage.** Concretely: I hand him `UrgencyClass` + the completeness field-list; he hands me an entry-read interface for trends. Both can be agreed on paper in one sitting.

### 3.3 On Brian — UI

| I need | Spec | Blocks |
| --- | --- | --- |
| Reviewed `en`/`sw` strings for my `explanationKeys` | §10.4.A: *"Critical fixed strings must live in reviewed locale files… Do not live-translate safety-critical fixed strings with Claude at render time"* | Patient-facing shipping. **Not** engine logic |
| Urgent banner that the chat flow cannot hide | §10.3.B, §10.6: *"emergency banner cannot be visually hidden by chat flow"* | §8.3.B step 3 in the web channel |
| Consent + check-in-preference UI | §10.3.D | §8.4.A |
| Joint prohibited-pattern corpus per language | §10.4.D | Diagnosis guard coverage in Kiswahili/code-switch |

### 3.4 On Noordin / Dancun — delivery channels (§8.5)

Check-in *delivery* needs a channel. Both are **Phase 2** (§23) while my profiling work is **Phase 1** — so V1 check-in delivery is unresolved (§5 issue H). Schedule storage, due-date computation and consent are all buildable without them.

### 3.5 Hassan — not a blocker

§8.5 lists *"Hassan: care routing after urgency outcome"* under **my** dependencies. That is backwards: Hassan *consumes* my `UrgencyClass` (§9.5.D: *"emergency capability when urgency is emergency"*). Minor spec inaccuracy; treat as a downstream consumer, not a dependency.

### 3.6 What I can build with **zero** external dependencies

This is the majority of §8, and it is why the engine can start today:

1. Rule definition format + `safetyRuleSchema` fix + the first reviewed rule set (`docs/clinical-rules/`)
2. Pure deterministic rule evaluator: normalized facts in → `SafetyAssessment` out. No Redis, no Supabase, no Claude, no network
3. Red-flag-first ordering + complaint-pathway required-field tables
4. Unknown-state resolution
5. All six §8.6 unit tests, using fixtures rather than live services
6. Diagnosis-language guard deterministic layer (en + sw patterns) — §14
7. Follow-up schedule domain logic: `daily | weekly | custom` → next-due computation; withdrawal stops future occurrences. Pure function, testable long before Supabase exists
8. Trend calculation as a pure function over an observation array, driven by fixtures
9. Check-in template selection from prior facts (§8.4.C) — pure
10. Regression corpus additions in `packages/testing`

---

## 4. Build order — smallest first shippable slice at the top

Each slice is independently mergeable and independently testable.

### Slice 1 — Rule format + contracts *(no runtime, no dependencies)*
- Fix `safetyRuleSchema`: add `conditions`, type `urgencyResult` as `urgencyClassSchema`, require `reviewedBy`/`reviewedAt` when `status === "active"`
- Define and PR `severityEvaluationInputSchema` into `packages/contracts`
- Write `docs/clinical-rules/` rule-source format + review process note
- **Ships:** a reviewable rule format. **Unblocks:** everyone who needs to know the shape.

### Slice 2 — Pure deterministic evaluator ⭐ *smallest slice that demos §28*
- Rule registry + `ruleSetVersion` pinning
- Evaluator: normalized facts → `SafetyAssessment`, no I/O
- First red-flag rule set (small, clinically reviewed)
- Tests: determinism (§8.6), ordering immunity (§8.6)
- **Demo (§28):** *"the same normalized facts always yield the same urgency class/rule IDs"*
- **Dependencies: none.** This is where I start.

### Slice 3 — Missing critical facts + unknown state
- Complaint-pathway required-field tables (§8.3.B step 4)
- `missingCriticalFacts` population, `unknown` resolution (§8.3.C)
- Question prioritisation: critical before lower-value (§8.3.B step 5)
- **Demo (§28):** *"missing critical information requests the right question"*
- **Dependencies: none.**

### Slice 4 — Diagnosis-language guard (§14, §10.4.D)
- Deterministic prohibited-pattern layer, en + sw, paraphrase and code-switch cases
- Wire into `packages/testing/src/regression`
- Test: *"no diagnostic language in severity or trend statements"* (§8.6)
- **Dependency:** joint pattern corpus with Brian/Evans — but I can ship the English layer first.

### Slice 5 — `POST /api/v1/severity/evaluate`
- Replace the 501 stub; middleware order per `conventions.md`
- Stateless facts-in form first; session-backed form once Evans's session service lands
- §20 failure behaviour: conservative approved response + critical alert
- Safe telemetry: `urgency`, `ruleId` only (§18)
- **Dependency:** Evans's session service for the session-backed variant *only*.

### Slice 6 — Follow-up schedule domain logic + consent gate *(pure)* — **DONE**
- `daily | weekly | custom` cadence, next-due computation
- Consent model: what-is-stored, contact frequency, channel selection, consent version, withdrawal (§8.4.A)
- Test: *"consent withdrawal stops future check-ins"* (§8.6)
- **Dependency:** consent-version shape agreed with Duncan. Logic is testable before storage exists.

### Slice 7 — Schedule persistence + `POST`/`DELETE /api/v1/profile/followups` — **DONE**
- Migrations for `follow_up_schedules` / `health_profile_settings` (pending §5 issue G)
- Schedule is the persistent source of truth (§8.4.B)
- **Dependency:** Duncan's Supabase/RLS baseline.

### Slice 8 — `followups` worker processor — **NOT BUILT (deferred to Phase 2)**
Superseded by the resolution of §5 issue H: V1 delivery is in-app pull, so there is no
processor and no delivery channel. The schedule storage this slice would have read is
already in place, so the processor is additive when a channel exists.

- Due schedules → delivery jobs, idempotency key per occurrence (§4.G)
- Worker delivers the *question*; it never evaluates severity (§2.1)
- **Dependency:** Evans's BullMQ wiring + a delivery channel (§5 issue H).

### Slice 9 — Check-in intake → re-evaluation + trends — **DONE**
- Every check-in answer re-runs the engine synchronously (§8.4.E)
- Trend statements from stored entries (§8.4.D)
- Tests: *"worsening follow-up can trigger a higher urgency"*, *"a profile cannot suppress a new red flag"*
- **Dependency:** Duncan's entry storage. **Heaviest dependency in the plan** — deliberately last of the WS4 slices.

### Slice 10 — MCP safety semantics (WS9)
- Tool descriptions per §13.4.B, annotations per §13.4.F, consent boundaries, clinical regression tests (§13.5)
- **Phase gate — §23 Phase 3:** only *"after session, PII, severity, and consent contracts are working."*

---

## 5. Ambiguities and contradictions — decisions needed before I code

Ordered by how much they block Slice 2.

### A. `urgent_today` vs `urgent` — **spec contradicts itself**
§8.2 defines `"urgent_today"`. §6.3.D's `SystemScoreSnapshot` defines `urgencyClass: "emergency"|"urgent"|"soon"|"monitor"|"unknown"` — **`"urgent"`, not `"urgent_today"`**.
`packages/contracts` already resolved this in favour of §8.2 (`scores.ts` imports `urgencyClassSchema`), so the code is consistent. **Decision needed:** confirm with Duncan that §8.2 wins and §6.3.D is the typo. *Blocks: nothing, but must be confirmed before rules are written against the enum.*

### B. Claude currently returns `urgency` — **existing code contradicts §8.3.A**
`consultationSummarySchema` in `packages/contracts/src/ai.ts` has `urgency: urgencyClassSchema` as a field the **Claude summarization call returns**. That directly violates:
- §8.3.A: *"Do not let Claude directly return the final urgency class without the rule engine checking/deciding it."*
- §6.3.D: *"urgency comes from Antonia's safety/severity engine, not from an LLM guess."*

**Proposed fix:** urgency becomes an *input* to `summarizeSession`, not an output. **Decision needed with Evans.** *This is the highest-priority item on the list — it is a live constitution violation baked into a merged contract.*

### C. Severity evaluation input is unspecified
§8.2 defines the output; nothing defines the input. The stub is `evaluate(session: unknown)`. Three sub-questions:
1. Does it take a whole `KkdSession`, or just normalized facts? A whole session couples the engine to Redis and makes MCP `kkd.evaluate_urgency` awkward.
2. §8.4.E requires the same engine to run on check-ins, where **there is no session**. That argues for facts-in.
3. §8.6 demands *"deterministic same-input/same-rule-version behavior"*, and §8.6 also demands *"worsening follow-up can trigger a higher urgency"* — so prior observations must be an **explicit input**, never an internal lookup, or determinism is unprovable.

**My recommendation:** `evaluate(facts, priorObservations?, ruleSetVersion)` — pure, session-free. Session wiring lives in the API layer. **Decision needed.** *Blocks Slice 1.*

### D. `requiresHumanEscalation` has no defined trigger
§8.2 declares the field; §8 never says when it is true. It is consumed by Dancun (§12.3.E human handoff) and implied by Hassan's routing (§9.5.D).
**Question:** does `emergency` always imply it, or is it an independent rule outcome (e.g. self-harm disclosure at non-emergency urgency)? **Decision needed with Dancun.** *Blocks Slice 2 rule authoring.*

### E. Who owns the diagnosis-language guard?
- §14 presents it as cross-workstream: *"Maintain a shared policy service"* — no owner named.
- §10.4.D says *"Work with Evans/Antonia"*.
- §13.4.E puts it at the end of the MCP chain.
- But the `DiagnosisLanguageGuard` **interface already sits in `packages/clinical-safety`** — my package.
- `conventions.md` does not assign it.

**Decision needed:** I am willing to own it (it is already in my package and my regression corpus covers it), but it applies to web, WhatsApp, USSD, voice, MCP and exports — so if it is mine, every channel owner depends on me. Needs an explicit call. *Blocks Slice 4.*

### F. No clinical reviewer or review process exists — **hard blocker on wording**
The spec repeatedly requires clinical sign-off but never names a reviewer or a process:
- §8.2: *"a small, clinically reviewed disposition enum"*
- §8.3.A: rules carry `reviewed_by`, `reviewed_at`
- §8.3.B: *"return the **approved** safety message"*
- §8.3.D: *"All exact wording requires clinical review."*
- §20: *"Conservative **approved** failure response"*
- §10.4.A: reviewed locale files

The audience list in the spec header includes *"clinical advisors"*, but §3's ownership table has no clinical reviewer.
**Decision needed:** who signs `reviewed_by`, and what does "approved" mean procedurally?
**Workaround so I am not blocked:** I build with `explanationKeys` only and rule status `draft`. No patient-facing string ships from my packages until this is answered. *Blocks patient-facing release, not engine work.*

### G. Who owns the `follow_up_schedules` migration?
§4.D lists `follow_up_schedules` and `health_profile_settings` among Evans's persistent tables. §6.2's Duncan table list **omits both**. `conventions.md` gives Duncan *"`supabase` record tables"*. `supabase/migrations/README.md` says *"Persistent tables are owned by feature workstreams"* — which points at me.
**Decision needed:** I propose I own these two migrations, since §8.4.B assigns me the schedules. Needs Duncan's agreement so we do not collide on RLS patterns. *Blocks Slice 7.*

### H. Which channel delivers a check-in in V1? — **RESOLVED: in-app pull**

**Decision (2 September 2026, Antonia):** V1 check-in delivery is **in-app pull**. A
patient sees due check-ins when they open the app. There is no push delivery, no
delivery-channel dependency, and **no BullMQ processor** — Slice 8 is not built.

The constraints that forced it:

- `Channel` is `web | whatsapp | ussd | voice | mcp`. There is **no SMS or email
  channel**, and no transport exists for one.
- WhatsApp/USSD (Noordin) and voice (Dancun) are **Phase 2** (§23); profiling is
  **Phase 1**. Blocking Phase 1 on a Phase 2 channel would leave §8.4 unbuilt.
- §2.1 forbids queueing anything that determines what the current user should do. A
  pulled check-in is answered synchronously and re-evaluated synchronously, so the
  safety path never enters a queue at all.

How it is implemented:

- `GET /api/v1/profile/checkins/due` is the delivery mechanism. It computes due
  occurrences from the stored schedule, with the request's clock passed in.
- §8.4.B's "store the source schedule persistently and create delivery jobs from it" is
  honoured in the half that matters: `follow_up_schedules` is the persistent source of
  truth, and an occurrence is derived from it (`<scheduleId>:<dueAt>`), never from an
  endlessly delayed job. When a push channel lands, a `followups` processor reads the
  same schedules and produces the same occurrence ids — nothing about the storage model
  has to change.
- §8.4.A's "allow channel selection" is implemented and **enforced**:
  `V1_DELIVERABLE_CHECK_IN_CHANNELS` is `["web"]`, and consent to any other channel is
  refused with `checkin_channel_not_available` rather than stored and quietly ignored. A
  recorded preference KKD cannot honour would be a promise of contact it cannot keep.

**Phase 2 follow-up:** when a delivery channel exists, add the `followups` processor
(Slice 8) and widen `V1_DELIVERABLE_CHECK_IN_CHANNELS`. Both are additive; no stored
schedule needs migrating.

### I. Who computes `completenessPercent`?
§6.3.D lists completeness under Duncan's System Score: *"completeness is based on question-pathway fields actually answered"*. But **I define the question pathways** (§8.3.B step 4). `assessmentCompletenessSchema` (`{percent, missingFieldIds}`) already exists in `contracts/safety.ts` — my file — while `completenessPercent` lives in Duncan's `systemScoreSnapshotSchema`.
**Decision needed:** I propose I emit `AssessmentCompleteness` (I own the denominator) and Duncan copies `percent` into his snapshot. Also note §6.5: *"completeness does not increase when fields are merely inferred"* — so only `confidence: "explicit" | "clarified"` counts, never `"uncertain"`. Confirm.

### J. Who computes `trajectory` vs. the trend *sentence*?
§6.3.D puts `trajectory` in Duncan's snapshot with the `insufficient_data` rule. §8.4.D puts trend *statements* with me. `trajectorySchema` is in `contracts/scores.ts` (Duncan's file).
**Decision needed:** I propose Duncan computes the `trajectory` enum from stored entries, and I own the patient-facing factual sentence (it must pass my diagnosis guard). Avoids two implementations of "worsening".

### K. What is a session's `safety` value *before* the first message?
§5's `KkdSession.safety: SafetyAssessment` is **non-optional**, so a session must carry an assessment from creation — before any facts exist.
**Decision needed:** confirm the zero-state is `urgency: "unknown"`, `ruleIds: []`, `ruleSetVersion` pinned. Risk: `unknown` then means two different things — "not yet evaluated" and §8.3.C's "evaluated, could not be established". If the UI treats them identically we may show false reassurance, which §8.3.C explicitly forbids. May need an `evaluatedAt`/`ruleIds.length` convention instead of a new enum value.

### L. Is rule-set version immutable once used in production?
§6.3.D states it for scores: *"algorithm versions are immutable once used in production"*. §8 states no equivalent for `ruleSetVersion`, but §8.6's determinism test and §8.7's *"every decision identifies rule IDs/version internally"* only hold if it is.
**Decision needed:** confirm rule-set versions are immutable once used in production, mirroring §6.3.D.

### M. Can MCP `kkd.evaluate_urgency` be called without a session? *(WS9)*
§13.3 lists the tool and §13.4.C gives it the `safety:evaluate` scope. §13.4.D says *"Reject patient-conversation calls where disclosure requirements are unmet."*
**Question:** is a stateless `evaluate_urgency` a "patient-conversation call"? If yes, it needs a disclosure acknowledgement. If no, an external agent can obtain urgency dispositions with no disclosure and no session — which reads against §15 (*"Every session opens by saying AI is involved"*).
**My inclination:** require disclosure state for any tool that returns a patient-facing disposition. **Decision needed with Evans** — defer until Slice 10, but flag now.

---

## 6. Summary

- **Start today, unblocked:** Slices 1–4 (rule format, deterministic evaluator, unknown state, diagnosis guard). Roughly two thirds of §8's engine logic needs no other owner's code.
- **Resolve immediately:** issue **B** (Claude currently returns `urgency` — live constitution violation in merged contracts) and issue **C** (evaluation input contract — blocks Slice 1).
- **Book one meeting each:** Duncan (issues A, G, I, J), Evans (B, C, E, M), Dancun (D), team (F, H, K, L).
- **Hard external blockers:** Duncan's record layer (Slice 9), a named clinical reviewer (any patient-facing wording), a V1 check-in delivery channel (Slice 8).
- **MCP is last** by §23 Phase 3 and stays last.
