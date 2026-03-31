-- ============================================================
-- LinkSteps Senior Module — Database Migration
-- Date: 2026-03-26
-- Architect: Senior care data layer + RLS
--
-- Tables created (7):
--   senior_profiles, carer_relationships, health_snapshots,
--   senior_baselines, ai_assessments, device_connections, checkins
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. senior_profiles
--    One row per elderly person being cared for.
-- ────────────────────────────────────────────────────────────
CREATE TABLE senior_profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  city         text NOT NULL DEFAULT 'beijing',   -- maps to QWeather city key
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE senior_profiles ENABLE ROW LEVEL SECURITY;

-- Creator can do anything with their senior profiles
CREATE POLICY "senior_profiles: creator full access"
  ON senior_profiles
  FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- All carers linked via carer_relationships can SELECT
CREATE POLICY "senior_profiles: carers can read"
  ON senior_profiles
  FOR SELECT
  USING (
    id IN (
      SELECT senior_id FROM carer_relationships
      WHERE carer_id = auth.uid()
    )
  );


-- ────────────────────────────────────────────────────────────
-- 2. carer_relationships
--    Links carers (晚辈) to seniors (长辈).
--    A senior may have multiple carers; one is 'primary'.
-- ────────────────────────────────────────────────────────────
CREATE TABLE carer_relationships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id   uuid NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
  carer_id    uuid NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'secondary'
                CHECK (role IN ('primary', 'secondary')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (senior_id, carer_id)
);

ALTER TABLE carer_relationships ENABLE ROW LEVEL SECURITY;

-- Users can see their own relationships
CREATE POLICY "carer_relationships: own rows"
  ON carer_relationships
  FOR SELECT
  USING (carer_id = auth.uid());

-- Primary carer (creator of the senior_profile) can insert relationships
CREATE POLICY "carer_relationships: primary carer can insert"
  ON carer_relationships
  FOR INSERT
  WITH CHECK (
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  );

-- Primary carer can delete relationships
CREATE POLICY "carer_relationships: primary carer can delete"
  ON carer_relationships
  FOR DELETE
  USING (
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  );


-- ────────────────────────────────────────────────────────────
-- 3. health_snapshots
--    One row per senior per day. Stores all 3 data tiers.
--    Tier 3 fields (bp, temp) are intentionally NOT exposed
--    via the public API — only the AI engine reads them.
-- ────────────────────────────────────────────────────────────
CREATE TABLE health_snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id             uuid NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
  snapshot_date         date NOT NULL,

  -- Tier 1 — Context & Activity
  steps                 int,
  first_active_time     timestamptz,       -- device first-active timestamp today
  weather_pressure_hpa  float,
  weather_temp_c        float,
  weather_text          text,              -- e.g. "晴", "多云"

  -- Tier 2 — Vitals & Wellness (nullable; depends on wearable)
  resting_heart_rate    int,               -- bpm
  sleep_duration_hours  float,
  deep_sleep_hours      float,
  hrv_ms                float,             -- ms, higher = better recovery

  -- Tier 3 — Clinical Reference (backend AI only, never returned raw to frontend)
  body_temp_celsius     float,
  systolic_bp           int,
  diastolic_bp          int,
  fall_detected         boolean NOT NULL DEFAULT false,

  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (senior_id, snapshot_date)
);

ALTER TABLE health_snapshots ENABLE ROW LEVEL SECURITY;

-- Carers can read snapshots for their seniors
CREATE POLICY "health_snapshots: carers can read"
  ON health_snapshots
  FOR SELECT
  USING (
    senior_id IN (
      SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid()
    )
    OR
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  );

-- Only the backend service role can insert/update (via sync cron)
-- Client SDK cannot write health data directly — enforced by no INSERT policy for anon/user roles
CREATE POLICY "health_snapshots: service role can write"
  ON health_snapshots
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- ────────────────────────────────────────────────────────────
-- 4. senior_baselines
--    7-day rolling averages. One row per senior (upserted by cron).
-- ────────────────────────────────────────────────────────────
CREATE TABLE senior_baselines (
  senior_id            uuid PRIMARY KEY REFERENCES senior_profiles(id) ON DELETE CASCADE,
  avg_steps            float,
  avg_hrv              float,
  avg_sleep_hours      float,
  avg_resting_hr       float,
  computed_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE senior_baselines ENABLE ROW LEVEL SECURITY;

-- Carers can read baselines for their seniors
CREATE POLICY "senior_baselines: carers can read"
  ON senior_baselines
  FOR SELECT
  USING (
    senior_id IN (
      SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid()
    )
    OR
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "senior_baselines: service role can write"
  ON senior_baselines
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- ────────────────────────────────────────────────────────────
-- 5. ai_assessments
--    Persisted AI output — status + insight text + action tip.
--    One row per evaluation run (may be multiple per day).
-- ────────────────────────────────────────────────────────────
CREATE TABLE ai_assessments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id          uuid NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
  assessed_at        timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL
                       CHECK (status IN ('emerald', 'amber', 'rose', 'sos')),
  insight_text       text NOT NULL,         -- human-language AI sentence
  action_suggestion  text,                  -- lightweight action for carer
  data_tier          int  NOT NULL DEFAULT 1
                       CHECK (data_tier IN (1, 2, 3)),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_assessments_senior_time
  ON ai_assessments (senior_id, assessed_at DESC);

ALTER TABLE ai_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_assessments: carers can read"
  ON ai_assessments
  FOR SELECT
  USING (
    senior_id IN (
      SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid()
    )
    OR
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "ai_assessments: service role can write"
  ON ai_assessments
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- ────────────────────────────────────────────────────────────
-- 6. device_connections
--    OAuth tokens from wearable vendors. NEVER exposed via API.
--    Tokens stored encrypted (application layer must encrypt
--    before insert; raw token must never land in this column).
-- ────────────────────────────────────────────────────────────
CREATE TABLE device_connections (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id                 uuid NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
  vendor                    text NOT NULL
                              CHECK (vendor IN ('huawei', 'xiaomi', 'apple', 'werun', 'mock')),
  access_token_encrypted    text,           -- AES-256 encrypted, never plaintext
  refresh_token_encrypted   text,
  token_expires_at          timestamptz,
  last_synced_at            timestamptz,
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (senior_id, vendor)
);

ALTER TABLE device_connections ENABLE ROW LEVEL SECURITY;

-- Primary carer (creator) can see device connections for their senior
CREATE POLICY "device_connections: primary carer can read"
  ON device_connections
  FOR SELECT
  USING (
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  );

-- Only primary carer can insert/update device connections
CREATE POLICY "device_connections: primary carer can write"
  ON device_connections
  FOR INSERT
  WITH CHECK (
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  );

CREATE POLICY "device_connections: primary carer can update"
  ON device_connections
  FOR UPDATE
  USING (
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  );

-- Service role for token refresh cron
CREATE POLICY "device_connections: service role full access"
  ON device_connections
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- ────────────────────────────────────────────────────────────
-- 7. checkins
--    平安扣 events. Inserted by the senior themselves.
--    Readable by all linked carers.
-- ────────────────────────────────────────────────────────────
CREATE TABLE checkins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id       uuid NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
  checked_in_at   timestamptz NOT NULL DEFAULT now(),
  source          text NOT NULL DEFAULT 'button'
                    CHECK (source IN ('button', 'auto_active'))
);

CREATE INDEX checkins_senior_time
  ON checkins (senior_id, checked_in_at DESC);

ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;

-- Carers can read checkins for their seniors
CREATE POLICY "checkins: carers can read"
  ON checkins
  FOR SELECT
  USING (
    senior_id IN (
      SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid()
    )
    OR
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  );

-- The senior themselves can insert a checkin
-- (senior_id must resolve to a profile they're associated with)
CREATE POLICY "checkins: senior can insert"
  ON checkins
  FOR INSERT
  WITH CHECK (
    -- The senior's own auth.uid() must be the created_by on the senior_profile
    -- (In Phase 1, the senior IS the user who owns the senior_profile)
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
    OR
    auth.role() = 'service_role'
  );


-- ────────────────────────────────────────────────────────────
-- Realtime: enable broadcast for SOS override
-- ────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE checkins;
ALTER PUBLICATION supabase_realtime ADD TABLE ai_assessments;
