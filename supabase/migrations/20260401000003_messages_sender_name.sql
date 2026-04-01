-- Add sender_name to messages for denormalized display without cross-user profile lookups.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sender_name text;
