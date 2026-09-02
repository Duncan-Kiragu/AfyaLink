# Queues (BullMQ + Redis)

Background jobs for KKD. Safety/urgency evaluation is **not** queued; it stays synchronous in the API (spec §2.1).

## Local

```bash
docker compose up -d redis
cp .env.example .env   # REDIS_URL=redis://127.0.0.1:6379
pnpm dev               # API + worker both talk to the same Redis
```

`GET /api/v1/health/ready` must report `"redis": true` before anonymous sessions are accepted.

## Queues

| Queue | Payload contract | Side effects |
| --- | --- | --- |
| `followups` | `followupJobSchema` | Not implemented yet (Antonia). Jobs fail into the failed set. |
| `notifications` | `notificationJobSchema` | Not implemented yet. No phone or message body in the payload. |
| `provider-sync` | `providerSyncJobSchema` | Not implemented yet. |
| `voice-callbacks` | `voiceJobPayloadSchema` | Mock interview callback / summary SMS (Dancun). Enqueued via `enqueueOnQueue`. |
| `exports` | `recordExportJobSchema` | Builds a JSON export bundle and caches it under a TTL (Duncan). Ids and format only in the job. |
| `purges` | `purgeJobPayloadSchema` | Verifies record-row deletion; deletes Redis session keys by id (never reads the value); sweeps session keys that lost their TTL. |
| `analytics` | `analyticsJobSchema` | `queue_probe` is the bootstrap smoke job. |

Publish from the API with `enqueueOnQueue` in `apps/api/src/services/queues.ts`. Workers are started in `apps/worker`. Both use prefix `kkd:bull`.

Every job uses `jobId = idempotencyKey`, exponential backoff (5 attempts), and keeps the last 1000 failed jobs for review.

## Failed-job review (dead letter)

Failed jobs stay in BullMQ's failed set (`removeOnFail.count = 1000`). Logs emit `job_failed` with the queue name only — never `job.data`.

Inspect on a box that can reach Redis:

```bash
# from a Node REPL in apps/worker, or any script using @kkd/queue
```

Counts appear on the worker as `queue_depth` with `status` like `followups:0/2` (waiting/failed).

## Session purge

Close-session already `DEL`s `kkd:session:{id}`. The purge worker:

- `session_purge` — `DEL` the key again without `GET`
- `session_orphan_sweep` — `SCAN kkd:session:*` and `DEL` keys whose TTL is `-1` (no expiry). It does not read values.

## Failure

| Failure | Behaviour |
| --- | --- |
| Redis down at API boot | `/ready` is 503. Anonymous sessions are not created (spec §20). |
| Redis down when enqueueing | `enqueueOnQueue` returns `failed`/`skipped`. Feature code may fall back in-process if that path already exists. |
| Redis down in the worker | Worker logs `no_redis` or `degraded` and reconnects. |
| Retryable processor error | Exponential backoff, then the job sits in the failed set. |

## Observability

Safe events: `worker_boot`, `job_queued`, `job_failed`, `queue_depth`, `session_purged`, `session_orphan_purged`, `queue_probe`. Do not log payloads, transcripts, or Redis URLs.

## Staging

Render Key Value (`kkd-redis-stage`) uses `noeviction` so BullMQ job keys are not LRU-evicted. Session keys still expire via `EX`. Wire `REDIS_URL` from the instance connection string. Use a separate Redis for production.
