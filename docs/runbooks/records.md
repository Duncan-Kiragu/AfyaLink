# Health records + System Score (KKD-RECORDS-001)

Patient-owned persistent records and non-diagnostic process scores. Clinic/anonymous transcripts are not written here.

## Local demo

1. Set `FEATURE_HEALTH_RECORDS=true` (see `.env.example`).
2. `APP_ENV=local` uses the in-memory store unless `KKD_RECORDS_STORE=supabase` is set. Live Supabase needs `20260902120000_health_records.sql` applied first (the project we probed did not have `health_records` yet).
3. Authenticate as a user. In local/test only, send `x-kkd-user-id: <uuid>`. Staging and production must use a Supabase access token (`Authorization: Bearer`).
4. `POST /api/v1/records/consent` with `{ "version": "records.persist.v1" }`.
5. `POST /api/v1/records` then persist selected facts:
   - `POST /api/v1/records/:id/persist` with an explicit `facts[]` list (no transcript field), or
   - `POST /api/v1/records/:id/persist-from-voice` with `{ consentVersion, sessionId, selectedFactIds }` while the voice session is still open.
6. `POST /api/v1/records/:id/scores` with `{}`. Urgency is computed by `evaluateSeverity` using the draft red-flag rule set (`executeUnreviewedDraftRules: true`). A client `urgencyClass` is ignored.
7. `GET /api/v1/records/:id/scores` and `POST /api/v1/records/:id/export` `{ "format": "json" }`. The JSON bundle is stored in Redis (`kkd:record-export:<jobId>`) when `REDIS_URL` is set, with a process-memory fallback. The worker regenerates the same bundle and rewrites the Redis key.
8. Repeat as a second user: the first record must 404.
9. Browser demo (APP_ENV=local): voice summary → select facts → Save → `/profile/history` → `/settings/privacy` export/delete. The web client sends `x-kkd-user-id` from a local demo UUID.

There is no `/diagnosis-score` route.

## Environment

| Variable | Notes |
| --- | --- |
| `FEATURE_HEALTH_RECORDS` | `true` to mount the APIs. |
| `RECORD_EXPORT_TTL_SECONDS` | Implementation default `900`. Not a BRD retention figure; change if product/privacy names one. |
| `RECORD_EXPORT_SIGNING_SECRET` | Required when the flag is on and `APP_ENV` is not `local`. Used for expiring download signatures. Not a public bucket. |

Apply `supabase/migrations/20260902120000_health_records.sql` on the staging/production Supabase projects Evans owns. Until that lands, local demo uses memory only.

## Privacy data flow

| Step | Data | Destination | Retention |
| --- | --- | --- | --- |
| Consent grant | user id, consent version, purpose | `consents` | Until withdrawn, then marked withdrawn |
| Persist selected facts | normalized facts the user approved | `health_record_entries` (+ measurements / medications when structured) | Until the user deletes the record |
| Source session id | raw ephemeral id | SHA-256 hash only, optional | Same as the entry |
| Raw clinic transcript | — | **Not stored** | — |
| System score | process components + explanations | `score_snapshots` | Until the user deletes the record |
| JSON export | record + entries + scores | Redis key `kkd:record-export:<jobId>` when Redis is up; otherwise API process memory | `RECORD_EXPORT_TTL_SECONDS` |
| Export/purge jobs | ids and format only | BullMQ `exports` / `purges` | Job retention of the worker. Purge verifies dependent rows are gone; it does not invent a delayed-erasure window. |

Logs emit event name, status, urgency class, and algorithm version. They must not include patient wording, facts, or export JSON.

## Failure modes

| Failure | Behaviour |
| --- | --- |
| Unauthenticated | `401 unauthenticated`. Anonymous sessions cannot persist. |
| Missing/withdrawn consent | `403 consent_required` on create/append/persist. Delete and export still work for the owner. |
| Wrong consent version | `409 consent_version_mismatch`. |
| Cross-user access | `404 record_not_found` (no existence leak). |
| Supabase down in staging/production | `503 persistence_unavailable`. Do not fall back to memory (split-brain). |
| Redis/BullMQ down | Export still completes in API memory. Job enqueue is skipped. Download works on that API process only. |
| PDF export | `400 pdf_export_not_available`. JSON only in this ticket. |
| Feature flag off | `404 health_records_disabled`. |

I do **not** know an approved numeric retention policy beyond “delete dependents when the user deletes.” The purge worker counts remaining rows for that `recordId` and fails the job if any remain. It does not invent a delayed-erasure window.

Draft urgency rules are **not clinically reviewed**. Score create opts into `executeUnreviewedDraftRules` so the engine can return a class other than `unknown` before Antonia marks rules `active`.

Live RLS DML: `RUN_SUPABASE_RLS=1 pnpm --filter @kkd/api test src/modules/records/records.rls.live.test.ts`. Requires `SUPABASE_URL`, publishable key, and `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`. Creates two disposable Auth users and deletes them afterwards.

## Staging validation

1. Apply the migration; confirm RLS is enabled (`supabase/tests/health_records_rls.sql`).
2. Sign in as User A (real JWT). Grant consent, persist two facts, compute a score, export JSON, download via the signed path before expiry.
3. Sign in as User B. User A’s record id returns 404.
4. Confirm Sentry/logs for those calls contain no patient wording.
5. Delete the record; confirm entries and scores are gone.

## Observability

Safe events: `consent_granted`, `consent_withdrawn`, `record_created`, `record_entry_appended`, `facts_persisted`, `score_snapshot_created`, `export_completed`, `record_deleted`, `records_deleted_all`, `record_job_queued`.

## Rollback

- Set `FEATURE_HEALTH_RECORDS=false` to disable the APIs.
- Do not drop tables that already hold patient data without an approved deletion process.
- Algorithm version `kkd.system-score.v1` must not be silently changed. Ship a new version string if the formula changes.
