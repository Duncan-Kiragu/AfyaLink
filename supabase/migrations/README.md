# Migrations

Source-controlled. Do not edit production by hand.

`20260902120000_health_records.sql` (KKD-RECORDS-001) creates `consents`, `health_records`, `health_record_entries`, `measurements`, `reported_medications`, `score_snapshots`, and `record_exports` with RLS. Anonymous clinic transcripts do not belong in these tables.

Other suggested bootstrap tables (profiles, follow-up schedules, providers) stay with their owning workstreams.
