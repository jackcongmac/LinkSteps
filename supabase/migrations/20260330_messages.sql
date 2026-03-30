-- supabase/migrations/20260330_messages.sql
-- ============================================================
-- LinkSteps — Messages Table
-- Stores text messages (carer→senior) and voice memos (senior→carer)
-- ============================================================

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id        uuid NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL REFERENCES auth.users(id),
  sender_role      text NOT NULL CHECK (sender_role IN ('carer', 'senior')),
  type             text NOT NULL CHECK (type IN ('text', 'voice')),
  content          text,
  audio_url        text,
  audio_mime_type  text,
  is_read          boolean NOT NULL DEFAULT false,
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_content_check CHECK (
    (type = 'text'  AND content   IS NOT NULL AND audio_url IS NULL)
    OR
    (type = 'voice' AND audio_url IS NOT NULL AND content   IS NULL)
  )
);

CREATE INDEX messages_senior_time ON messages (senior_id, created_at DESC);

-- REPLICA IDENTITY FULL is required so Realtime UPDATE payloads include all columns
-- (default REPLICA IDENTITY DEFAULT only includes the primary key).
-- Without this, payload.new.senior_id is undefined and the carer-side filter breaks.
ALTER TABLE messages REPLICA IDENTITY FULL;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Carers and senior (Phase 1: same account) can read all messages for their senior
CREATE POLICY "messages: carers can read"
  ON messages FOR SELECT
  USING (
    senior_id IN (SELECT id FROM senior_profiles WHERE created_by = auth.uid())
    OR
    senior_id IN (SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid())
  );

-- Senior can mark messages as read (UPDATE is_read + read_at only)
CREATE POLICY "messages: senior can mark read"
  ON messages FOR UPDATE
  USING (
    senior_id IN (SELECT id FROM senior_profiles WHERE created_by = auth.uid())
  )
  WITH CHECK (
    senior_id IN (SELECT id FROM senior_profiles WHERE created_by = auth.uid())
  );

-- Sender can insert messages for seniors they are linked to
CREATE POLICY "messages: sender can insert"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      senior_id IN (SELECT id FROM senior_profiles WHERE created_by = auth.uid())
      OR senior_id IN (SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid())
    )
  );

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
