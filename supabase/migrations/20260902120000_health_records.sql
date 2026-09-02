-- KKD-RECORDS-001: patient-owned persistent health records and score snapshots.
-- Anonymous clinic transcripts must never be written to these tables.
-- Service-role bypasses RLS; API methods still filter on user_id.

CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  version text NOT NULL,
  purpose text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX consents_active_unique
  ON consents (user_id, purpose, version)
  WHERE withdrawn_at IS NULL;

CREATE TABLE health_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE health_record_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  record_id uuid NOT NULL REFERENCES health_records (id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (
    entry_type IN ('symptom', 'measurement', 'medication_report', 'checkin', 'note')
  ),
  concept_code text,
  patient_wording text,
  value_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_at timestamptz NOT NULL,
  source_channel text NOT NULL CHECK (
    source_channel IN ('web', 'whatsapp', 'ussd', 'voice', 'mcp')
  ),
  source_session_id_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT health_record_entries_hash_sha256
    CHECK (source_session_id_hash IS NULL OR source_session_id_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  record_id uuid NOT NULL REFERENCES health_records (id) ON DELETE CASCADE,
  entry_id uuid REFERENCES health_record_entries (id) ON DELETE CASCADE,
  name text NOT NULL,
  value text NOT NULL,
  unit text,
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reported_medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  record_id uuid NOT NULL REFERENCES health_records (id) ON DELETE CASCADE,
  entry_id uuid REFERENCES health_record_entries (id) ON DELETE CASCADE,
  name text NOT NULL,
  patient_wording text,
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE score_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  record_id uuid NOT NULL REFERENCES health_records (id) ON DELETE CASCADE,
  severity_reported numeric,
  urgency_class text NOT NULL CHECK (
    urgency_class IN ('emergency', 'urgent_today', 'soon', 'monitor', 'unknown')
  ),
  completeness_percent integer NOT NULL CHECK (
    completeness_percent >= 0 AND completeness_percent <= 100
  ),
  trajectory text NOT NULL CHECK (
    trajectory IN ('improving', 'stable', 'worsening', 'insufficient_data')
  ),
  algorithm_version text NOT NULL,
  explanations jsonb NOT NULL,
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE record_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  record_id uuid NOT NULL REFERENCES health_records (id) ON DELETE CASCADE,
  format text NOT NULL CHECK (format IN ('json')),
  status text NOT NULL CHECK (status IN ('queued', 'completed', 'failed')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX health_records_user_id_idx ON health_records (user_id);
CREATE INDEX health_record_entries_user_id_idx ON health_record_entries (user_id);
CREATE INDEX health_record_entries_record_id_idx ON health_record_entries (record_id);
CREATE INDEX measurements_user_id_idx ON measurements (user_id);
CREATE INDEX reported_medications_user_id_idx ON reported_medications (user_id);
CREATE INDEX score_snapshots_user_id_idx ON score_snapshots (user_id);
CREATE INDEX score_snapshots_record_id_idx ON score_snapshots (record_id);
CREATE INDEX record_exports_user_id_idx ON record_exports (user_id);
CREATE INDEX consents_user_id_idx ON consents (user_id);

-- No anonymous inserts. Clinic session IDs are not a foreign key and cannot create rows.

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_record_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE reported_medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_exports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE consents FROM PUBLIC, anon;
REVOKE ALL ON TABLE health_records FROM PUBLIC, anon;
REVOKE ALL ON TABLE health_record_entries FROM PUBLIC, anon;
REVOKE ALL ON TABLE measurements FROM PUBLIC, anon;
REVOKE ALL ON TABLE reported_medications FROM PUBLIC, anon;
REVOKE ALL ON TABLE score_snapshots FROM PUBLIC, anon;
REVOKE ALL ON TABLE record_exports FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON TABLE consents TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE health_records TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE health_record_entries TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE measurements TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE reported_medications TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE score_snapshots TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE record_exports TO authenticated;

CREATE POLICY consents_select_own ON consents
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY consents_insert_own ON consents
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY consents_update_own ON consents
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY health_records_select_own ON health_records
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY health_records_insert_own ON health_records
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY health_records_delete_own ON health_records
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY health_record_entries_select_own ON health_record_entries
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY health_record_entries_insert_own ON health_record_entries
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY health_record_entries_delete_own ON health_record_entries
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY measurements_select_own ON measurements
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY measurements_insert_own ON measurements
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY measurements_delete_own ON measurements
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY reported_medications_select_own ON reported_medications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY reported_medications_insert_own ON reported_medications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY reported_medications_delete_own ON reported_medications
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY score_snapshots_select_own ON score_snapshots
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY score_snapshots_insert_own ON score_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY score_snapshots_delete_own ON score_snapshots
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY record_exports_select_own ON record_exports
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY record_exports_insert_own ON record_exports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY record_exports_delete_own ON record_exports
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
