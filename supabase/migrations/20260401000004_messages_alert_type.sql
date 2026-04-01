-- Add 'alert' as a valid message type for system-generated health/status events.
-- Also relax the content check so alerts (like the voice type) only need content.

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'voice', 'alert'));

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_check CHECK (
  (type = 'text'  AND content   IS NOT NULL AND audio_url IS NULL)
  OR
  (type = 'voice' AND audio_url IS NOT NULL AND content   IS NULL)
  OR
  (type = 'alert' AND content   IS NOT NULL AND audio_url IS NULL)
);
