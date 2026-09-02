-- KKD-SAFETY-001: follow-up schedules and check-in contact settings (spec §8.4.A, §8.4.B).
--
-- Builds on 20260902120000_health_records.sql and does not restate any of it:
--   * check-in answers are rows in `health_record_entries` with entry_type = 'checkin';
--   * consent to be contacted is a row in `consents` with purpose 'health_profile_checkins',
--     a second purpose on the existing table rather than a second consent model.
-- Spec §3.1 forbids a second model of the same thing, so there is no check-in answer
-- table and no profile-owned copy of a patient record here.
--
-- RLS, grants and index conventions follow the health-records migration exactly.
-- Service-role bypasses RLS; API methods still filter on user_id.

-- §8.4.A contact preferences. One row per user: the channel they selected and the
-- consent version that selection was made under. Kept out of `consents` because a
-- consent row records *that* permission was given, not how contact should happen.
CREATE TABLE health_profile_settings (
  user_id uuid PRIMARY KEY,
  channel text NOT NULL CHECK (
    channel IN ('web', 'whatsapp', 'ussd', 'voice', 'mcp')
  ),
  consent_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- §8.4.B: "store the source schedule persistently and create delivery jobs from it".
-- This table is that source of truth. next_due_at is a cached projection of
-- (cadence, start_at) and is always recomputed by the pure scheduler, never edited
-- independently, so a row can be replayed from its own cadence.
CREATE TABLE follow_up_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  record_id uuid NOT NULL REFERENCES health_records (id) ON DELETE CASCADE,
  cadence_kind text NOT NULL CHECK (
    cadence_kind IN ('daily', 'weekly', 'custom_interval', 'custom_once')
  ),
  cadence jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'withdrawn', 'completed')),
  channel text NOT NULL CHECK (
    channel IN ('web', 'whatsapp', 'ussd', 'voice', 'mcp')
  ),
  consent_version text NOT NULL,
  start_at timestamptz NOT NULL,
  next_due_at timestamptz,
  last_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A schedule that is not active can never be due again (spec §8.6, "consent
  -- withdrawal stops future check-ins"). Enforced in the database as well as in the
  -- service, so a future writer cannot revive a withdrawn schedule by setting a date.
  CONSTRAINT follow_up_schedules_inactive_has_no_due_date
    CHECK (status = 'active' OR next_due_at IS NULL)
);

CREATE INDEX follow_up_schedules_user_id_idx ON follow_up_schedules (user_id);
CREATE INDEX follow_up_schedules_record_id_idx ON follow_up_schedules (record_id);
-- The due-list query: active schedules for one user, ordered by when they came due.
CREATE INDEX follow_up_schedules_due_idx
  ON follow_up_schedules (user_id, next_due_at)
  WHERE status = 'active' AND next_due_at IS NOT NULL;

ALTER TABLE health_profile_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_schedules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE health_profile_settings FROM PUBLIC, anon;
REVOKE ALL ON TABLE follow_up_schedules FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE health_profile_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE follow_up_schedules TO authenticated;

CREATE POLICY health_profile_settings_select_own ON health_profile_settings
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY health_profile_settings_insert_own ON health_profile_settings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY health_profile_settings_update_own ON health_profile_settings
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY health_profile_settings_delete_own ON health_profile_settings
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY follow_up_schedules_select_own ON follow_up_schedules
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY follow_up_schedules_insert_own ON follow_up_schedules
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY follow_up_schedules_update_own ON follow_up_schedules
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY follow_up_schedules_delete_own ON follow_up_schedules
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
