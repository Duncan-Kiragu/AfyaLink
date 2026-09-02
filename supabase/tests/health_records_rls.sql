-- RLS isolation for KKD-RECORDS-001.
-- Run with `supabase test db` after applying 20260902120000_health_records.sql.
-- Cross-user DML is also covered by apps/api records HTTP tests (always-on).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

SELECT has_table('health_records');
SELECT has_table('health_record_entries');
SELECT has_table('score_snapshots');
SELECT has_table('consents');
SELECT has_table('record_exports');

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.health_records'::regclass
  ),
  'RLS is enabled on health_records'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.health_record_entries'::regclass
  ),
  'RLS is enabled on health_record_entries'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'health_records'
      AND policyname = 'health_records_select_own'
  ),
  'health_records has an own-row SELECT policy'
);

SELECT is(
  (
    SELECT COUNT(*)::integer
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'health_records'
      AND grantee = 'anon'
  ),
  0,
  'anon has no grants on health_records'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'health_record_entries'
      AND cmd = 'SELECT'
      AND qual ILIKE '%user_id%'
  ),
  'entry SELECT policy is scoped to user_id'
);

SELECT * FROM finish();
ROLLBACK;
