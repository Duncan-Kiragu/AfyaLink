# Health profiling — consent, schedules, check-ins, trends

Spec §8.4. Owner: Antonia (KKD-SAFETY-001). Feature flag: `FEATURE_HEALTH_PROFILE`
(also requires `FEATURE_HEALTH_RECORDS`).

## What this module is, and what it is not

It owns **the permission to contact a patient on a schedule**, the schedule itself, the
questions a check-in asks, the re-evaluation of every answer, and the trend statements.

It does **not** own patient data. Check-in answers are `health_record_entries` rows with
`entry_type = 'checkin'`, written through `records.service.ts`, so Duncan's consent gate,
ownership checks and RLS apply to them. Spec §3.1 forbids a second model of the same
thing, and there is none here: no check-in answer table, no profile-owned record copy.

## Two consents, both required

| Consent | Purpose | Owner | What it permits |
| --- | --- | --- | --- |
| `records.persist.v1` | `health_record_persistence` | Duncan | Storing the answer |
| `profile.checkins.v1` | `health_profile_checkins` | this module | Asking the question on a schedule |

They are two `purpose` values on Duncan's existing `consents` table, not two consent
models. A patient may reasonably want a record and no messages, so §8.4.A's disclosure
(what is stored, how often KKD makes contact, which channel, how to withdraw) is recorded
and withdrawn separately.

Withdrawal (`DELETE /api/v1/profile/consent`) stops future check-ins two independent ways:
the consent gate refuses every path, and every active schedule is set to `withdrawn` with
its `next_due_at` cleared. Neither depends on the other being remembered, and the database
`CHECK` constraint refuses a non-active schedule that still carries a due date.

## Delivery is in-app pull (V1)

`GET /api/v1/profile/checkins/due` is the delivery mechanism. There is no BullMQ processor
and no push channel: there is no SMS or WhatsApp transport, and both are Phase 2 (§23).
See `docs/adr/ws4-plan.md` §5 issue H for the full resolution. `follow_up_schedules` is the
persistent source of truth per §8.4.B; occurrences are derived from it as
`<scheduleId>:<dueAt>`, which is also the idempotency key for an answer.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/v1/profile/consent` | Disclosure + status. Renderable before consent. |
| `POST` | `/api/v1/profile/consent` | Version must be current; channel must be deliverable. |
| `DELETE` | `/api/v1/profile/consent` | Withdraws and stops every schedule. |
| `GET` | `/api/v1/profile/followups` | |
| `POST` | `/api/v1/profile/followups` | `daily`, `weekly`, `custom_interval`, `custom_once`. |
| `DELETE` | `/api/v1/profile/followups/:id` | Hard delete. Recorded answers stay in the record. |
| `GET` | `/api/v1/profile/checkins/due` | V1 delivery. |
| `POST` | `/api/v1/profile/followups/:id/checkins` | Answer → re-evaluation → trends, synchronously. |
| `GET` | `/api/v1/profile/trends?recordId=` | Guard-checked factual statements. |

All require authentication: profiling data is never anonymous (§8.7).

## Safety properties

- **Synchronous re-evaluation (§8.4.E, §8.7, §2.1).** Every submitted answer runs
  `evaluateSeverity` in the request. Nothing about urgency is queued.
- **A profile cannot suppress a red flag (§8.4.E).** Structural, not a rule someone
  remembered: no code path reads, compares or filters on a prior urgency, and the
  disposition is the maximum over firing rules.
- **The clock is always a parameter.** Routes take one `now` per request and thread it
  down; `packages/clinical-safety/src/profiling/schedule.ts` never reads the system clock,
  so due-date behaviour is testable and replayable.
- **Trends are guard-checked (§8.4.D, §8.6).** `buildTrendStatements` renders each
  statement with this patient's data and runs it through the diagnosis-language guard
  before emitting. Refused statements are counted, not returned. The guard fails closed on
  an unsupported locale.
- **Keys, never sentences.** Questions and trends are i18n keys plus data. Reviewed
  wording is Brian's (§10.4.A); nothing patient-facing ships from here.

## Telemetry (§18)

`checkin_consent_granted`, `checkin_consent_withdrawn`, `followup_schedule_created`,
`followup_schedule_deleted`, `checkin_evaluated`, `checkin_rule_fired`,
`trend_statement_suppressed`. All pass `assertSafeEvent`; no symptom text, no concept
codes, no patient data — a suppressed trend logs only the pattern id.

## Failure modes

| Failure | Behaviour |
| --- | --- |
| Check-in consent absent / withdrawn / superseded | `403 checkin_consent_*`, before anything is read or written |
| Record-persistence consent absent | `403 consent_required` (Duncan's gate) |
| Non-deliverable channel selected | `400 checkin_channel_not_available` |
| Cadence above the disclosed contact ceiling | `400 cadence_exceeds_disclosed_frequency` |
| One-off check-in scheduled in the past | `400 schedule_has_no_future_occurrence` |
| Replayed or stale occurrence | `409 occurrence_not_current` — never a duplicate entry |
| Answer with no usable concept code | `400 answer_concept_required` — refused, never silently dropped |
| Score snapshot write fails | Logged and skipped; the assessment is still returned |
| Persistence unavailable | `503 persistence_unavailable` |

## Rollback

Set `FEATURE_HEALTH_PROFILE=false`: every endpoint returns `404 health_profile_disabled`
and nothing new is written. Stored schedules are inert without the routes. The migration
`supabase/migrations/20260902150000_follow_up_schedules.sql` is additive — it creates two
new tables and touches none of Duncan's — so it can be left in place on rollback.
