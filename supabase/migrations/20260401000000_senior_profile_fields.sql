-- Add age, gender, relationship fields to senior_profiles
ALTER TABLE senior_profiles
  ADD COLUMN IF NOT EXISTS age          integer,
  ADD COLUMN IF NOT EXISTS gender       text CHECK (gender IN ('男', '女')),
  ADD COLUMN IF NOT EXISTS relationship text,
  ADD COLUMN IF NOT EXISTS custom_relation text;
