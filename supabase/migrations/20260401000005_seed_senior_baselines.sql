-- 20260401000005_seed_senior_baselines.sql
--
-- Upsert a realistic baseline for the demo senior profile.
-- Uses the same senior_id strategy as the seed file (first row in senior_profiles).
-- Safe to run multiple times (INSERT … ON CONFLICT DO UPDATE).

INSERT INTO senior_baselines (senior_id, avg_steps, avg_resting_hr, avg_sleep_hours, avg_hrv, computed_at)
SELECT
  id          AS senior_id,
  2800        AS avg_steps,          -- modest daily walking (elder baseline)
  72          AS avg_resting_hr,     -- healthy resting heart rate
  7.0         AS avg_sleep_hours,    -- target sleep
  35          AS avg_hrv,            -- typical elder HRV
  now()       AS computed_at
FROM senior_profiles
LIMIT 1
ON CONFLICT (senior_id) DO UPDATE
  SET avg_steps       = EXCLUDED.avg_steps,
      avg_resting_hr  = EXCLUDED.avg_resting_hr,
      avg_sleep_hours = EXCLUDED.avg_sleep_hours,
      avg_hrv         = EXCLUDED.avg_hrv,
      computed_at     = now();
