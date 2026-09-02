# Database tests

`health_records_rls.sql` checks that record tables exist, RLS is on, `anon` has no grants, and own-row policies are present.

Run with `supabase test db` after applying migrations. Cross-user HTTP isolation is covered by `apps/api/src/modules/records/records.routes.test.ts` and does not need a live database.
