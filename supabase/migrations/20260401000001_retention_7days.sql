-- 7-day data retention: auto-delete messages + checkins older than 7 days
-- Runs daily at 03:00 UTC (11:00 Beijing) via pg_cron.
--
-- REQUIRES: Enable pg_cron extension first in
--   Supabase Dashboard → Database → Extensions → pg_cron

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove any previous schedule with the same name (idempotent)
SELECT cron.unschedule('linksteps-retention-7d')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'linksteps-retention-7d'
);

SELECT cron.schedule(
  'linksteps-retention-7d',
  '0 3 * * *',   -- 03:00 UTC = 11:00 Beijing
  $$
    -- Delete voice message storage paths first (log them for reference)
    -- Note: storage objects must be deleted separately via Storage API
    DELETE FROM messages
    WHERE created_at < NOW() - INTERVAL '7 days';

    DELETE FROM checkins
    WHERE checked_in_at < NOW() - INTERVAL '7 days';
  $$
);
