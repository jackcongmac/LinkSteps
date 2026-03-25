# logs Table — Schema & RLS

## DDL

Run this in **Supabase Dashboard → SQL Editor**:

```sql
-- 1. Table
CREATE TABLE logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mood       TEXT        NOT NULL
             CHECK (mood IN ('Very Low', 'Not Great', 'Okay', 'Good', 'Great')),
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Index (fast user-scoped queries)
CREATE INDEX idx_logs_user_id ON logs (user_id);

-- 3. Enable RLS
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
```

## RLS Policies

```sql
-- Users can only read their own logs
CREATE POLICY "logs_select_own"
  ON logs FOR SELECT
  USING (user_id = auth.uid());

-- Users can only insert rows for themselves
CREATE POLICY "logs_insert_own"
  ON logs FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update only their own rows
CREATE POLICY "logs_update_own"
  ON logs FOR UPDATE
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can delete only their own rows
CREATE POLICY "logs_delete_own"
  ON logs FOR DELETE
  USING (user_id = auth.uid());
```

## Notes

- `mood` is stored as the human-readable label (`'Very Low'` … `'Great'`) to keep
  queries readable without a join.
- `note` is nullable — most check-ins won't include a note.
- No `child_id` in this MVP schema; can be added as `child_name TEXT` or a
  foreign key in a future iteration.
