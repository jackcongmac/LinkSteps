-- ============================================================
-- LinkSteps Senior — Phase 1 Field Test Seed
-- Date: 2026-03-26
-- Purpose: Seed Jack's mom profile + 7 days of mock health data
--          for the April 4th Shanghai field test.
--
-- HOW TO USE:
--   1. Replace <JACK_USER_ID> with Jack's actual auth.users.id
--      (find it in Supabase Dashboard → Authentication → Users)
--   2. Run in SQL Editor
-- ============================================================

DO $$
DECLARE
  jack_uid   uuid := '<JACK_USER_ID>';   -- ← replace this
  senior_id  uuid;
BEGIN

  -- ── 1. Create senior profile ──────────────────────────────
  INSERT INTO senior_profiles (id, created_by, name, city)
  VALUES (gen_random_uuid(), jack_uid, '妈妈', 'beijing')
  RETURNING id INTO senior_id;

  -- ── 2. Self-link Jack as primary carer ───────────────────
  INSERT INTO carer_relationships (senior_id, carer_id, role)
  VALUES (senior_id, jack_uid, 'primary');

  -- ── 3. Mock device connection (Phase 1 placeholder) ──────
  INSERT INTO device_connections (senior_id, vendor, is_active)
  VALUES (senior_id, 'mock', true);

  -- ── 4. 7-day health snapshots (今日 = 2026-04-04) ─────────
  -- Simulate typical Beijing spring: mild pressure, light steps
  INSERT INTO health_snapshots
    (senior_id, snapshot_date, steps, weather_pressure_hpa, weather_temp_c, weather_text,
     resting_heart_rate, sleep_duration_hours, deep_sleep_hours, hrv_ms)
  VALUES
    (senior_id, CURRENT_DATE - 6, 4200, 1014, 14, '晴',  68, 6.8, 1.6, 45),
    (senior_id, CURRENT_DATE - 5, 3800, 1012, 13, '多云', 70, 6.2, 1.3, 42),
    (senior_id, CURRENT_DATE - 4, 5100, 1015, 16, '晴',  67, 7.1, 1.8, 49),
    (senior_id, CURRENT_DATE - 3, 2900, 1008, 11, '阴',  72, 5.8, 1.1, 38),  -- low pressure day
    (senior_id, CURRENT_DATE - 2, 3200, 1006, 10, '小雨', 74, 5.5, 1.0, 36),  -- rainy, lower activity
    (senior_id, CURRENT_DATE - 1, 4500, 1013, 15, '晴',  69, 6.9, 1.7, 46),
    (senior_id, CURRENT_DATE,     4100, 1012, 14, '多云', 70, 6.5, 1.5, 44);

  -- ── 5. 7-day baseline (computed from above) ──────────────
  INSERT INTO senior_baselines (senior_id, avg_steps, avg_hrv, avg_sleep_hours, avg_resting_hr)
  VALUES (senior_id, 3971, 42.9, 6.4, 70.0);

  -- ── 6. Seed AI assessments (last 3 days for timeline) ────
  INSERT INTO ai_assessments
    (senior_id, assessed_at, status, insight_text, action_suggestion, data_tier)
  VALUES
    (senior_id, now() - interval '2 days',
     'amber',
     '妈妈这两天活动量有些偏低，睡眠也比平时浅。北京正值降雨，可能在家休息。',
     '今晚可以打个视频问候一下，不需要找话题，聊聊天气就好。',
     2),
    (senior_id, now() - interval '1 day',
     'emerald',
     '妈妈昨天状态不错，步数恢复正常，睡眠质量也有改善，看起来精神头很好。',
     NULL,
     2),
    (senior_id, now(),
     'emerald',
     '妈妈今天一切平稳，北京多云 14°C，已有活动记录。节律稳定。',
     NULL,
     1);

  -- ── 7. A recent check-in (simulating mom tapped 平安扣 this morning) ──
  INSERT INTO checkins (senior_id, checked_in_at, source)
  VALUES (senior_id, now() - interval '2 hours', 'button');

END $$;
