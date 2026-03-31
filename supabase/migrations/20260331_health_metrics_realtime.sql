-- Enable Realtime for health_metrics so the carer dashboard receives
-- live INSERT events without polling.
--
-- Run this once in Supabase Dashboard → SQL Editor.
-- The table itself must already exist (created in your schema migration).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'health_metrics'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE health_metrics;
  END IF;
END $$;
