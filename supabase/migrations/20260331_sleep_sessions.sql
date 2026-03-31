-- Sleep Sessions — one row per night per senior
-- current_state is non-null during an active session, null once completed.
-- RLS: creator full access (covers simulator writes), carers can read.

CREATE TABLE sleep_sessions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id      uuid        NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
  session_date   date        NOT NULL,
  started_at     timestamptz,
  ended_at       timestamptz,
  current_state  text        CHECK (current_state IN ('awake', 'light', 'deep')),
  total_hours    float,
  deep_hours     float,
  light_hours    float,
  rem_hours      float,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (senior_id, session_date)
);

ALTER TABLE sleep_sessions ENABLE ROW LEVEL SECURITY;

-- Creator (the user who owns the senior_profile) has full access.
-- This covers the simulator, which runs as the creator user in the browser.
CREATE POLICY "sleep_sessions: creator full access"
  ON sleep_sessions
  FOR ALL
  USING (
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  )
  WITH CHECK (
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  );

-- Linked carers can read sessions for their seniors
CREATE POLICY "sleep_sessions: carers can read"
  ON sleep_sessions
  FOR SELECT
  USING (
    senior_id IN (
      SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid()
    )
  );

-- Realtime: enable UPDATE events so the carer dashboard receives live state changes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'sleep_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sleep_sessions;
  END IF;
END $$;
