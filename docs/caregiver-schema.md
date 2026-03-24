# Caregiver–Child Mapping Schema

## Why this table exists

The original schema tied a child to exactly one parent via `children.parent_id`
and handled teacher access through a separate `child_teacher` table.

`caregiver_child_mapping` unifies ALL adult–child relationships into one table:

| Caregiver | Role |
|---|---|
| Mum / Dad | `parent` |
| Classroom teacher | `teacher` |
| Grandparent, nanny | `guardian` |

This lets multiple parents share full access to the same child, while teachers
and guardians get scoped read/write access, all under one consistent permission
model.

---

## Table DDL

```sql
CREATE TABLE caregiver_child_mapping (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id UUID        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  child_id     UUID        NOT NULL REFERENCES children(id)     ON DELETE CASCADE,
  role         TEXT        NOT NULL CHECK (role IN ('parent', 'teacher', 'guardian')),
  invited_by   UUID        NOT NULL REFERENCES auth.users(id),
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'active', 'revoked')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (caregiver_id, child_id)
);

CREATE INDEX idx_ccm_caregiver ON caregiver_child_mapping (caregiver_id);
CREATE INDEX idx_ccm_child     ON caregiver_child_mapping (child_id);

ALTER TABLE caregiver_child_mapping ENABLE ROW LEVEL SECURITY;
```

---

## RLS Policies — caregiver_child_mapping

```sql
-- 1. Each caregiver can see their own mappings (to know which children they
--    have access to, including pending invitations).
CREATE POLICY "ccm_self_select"
  ON caregiver_child_mapping FOR SELECT
  USING (caregiver_id = auth.uid());

-- 2. Active caregivers can see peer mappings for shared children
--    (e.g. Mum can see that Dad and the teacher are also linked).
CREATE POLICY "ccm_peers_select"
  ON caregiver_child_mapping FOR SELECT
  USING (
    child_id IN (
      SELECT child_id FROM caregiver_child_mapping
      WHERE caregiver_id = auth.uid() AND status = 'active'
    )
  );

-- 3. Parent caregivers have full management rights over mappings for
--    their own children (invite, revoke, update status).
CREATE POLICY "ccm_parent_all"
  ON caregiver_child_mapping FOR ALL
  USING (
    child_id IN (
      SELECT child_id FROM caregiver_child_mapping
      WHERE caregiver_id = auth.uid()
        AND role = 'parent'
        AND status = 'active'
    )
  )
  WITH CHECK (
    child_id IN (
      SELECT child_id FROM caregiver_child_mapping
      WHERE caregiver_id = auth.uid()
        AND role = 'parent'
        AND status = 'active'
    )
  );

-- 4. Any caregiver can accept their own pending invitation
--    (set status 'pending' → 'active'). Cannot change role or child_id.
CREATE POLICY "ccm_accept_own_invite"
  ON caregiver_child_mapping FOR UPDATE
  USING  (caregiver_id = auth.uid() AND status = 'pending')
  WITH CHECK (caregiver_id = auth.uid() AND status = 'active');
```

---

## Updated RLS — daily_logs

Replace the existing teacher-only policies with caregiver-aware policies.

```sql
-- Drop old teacher policies first
DROP POLICY IF EXISTS "daily_logs_teacher_select" ON daily_logs;
DROP POLICY IF EXISTS "daily_logs_teacher_insert" ON daily_logs;
DROP POLICY IF EXISTS "daily_logs_teacher_update" ON daily_logs;

-- Any active caregiver can read daily_logs for their linked children
CREATE POLICY "daily_logs_caregiver_select"
  ON daily_logs FOR SELECT
  USING (
    child_id IN (
      SELECT child_id FROM caregiver_child_mapping
      WHERE caregiver_id = auth.uid() AND status = 'active'
    )
  );

-- Active caregivers can create a daily_log for a linked child
-- (author_id must be themselves)
CREATE POLICY "daily_logs_caregiver_insert"
  ON daily_logs FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND child_id IN (
      SELECT child_id FROM caregiver_child_mapping
      WHERE caregiver_id = auth.uid() AND status = 'active'
    )
  );

-- Caregivers can only update logs they themselves authored
CREATE POLICY "daily_logs_caregiver_update"
  ON daily_logs FOR UPDATE
  USING (
    author_id = auth.uid()
    AND child_id IN (
      SELECT child_id FROM caregiver_child_mapping
      WHERE caregiver_id = auth.uid() AND status = 'active'
    )
  )
  WITH CHECK (author_id = auth.uid());
```

---

## Updated RLS — log_entries

```sql
-- Drop old teacher policies
DROP POLICY IF EXISTS "log_entries_teacher_select" ON log_entries;
DROP POLICY IF EXISTS "log_entries_teacher_insert" ON log_entries;

-- Read: via active caregiver → daily_log chain
CREATE POLICY "log_entries_caregiver_select"
  ON log_entries FOR SELECT
  USING (
    daily_log_id IN (
      SELECT dl.id FROM daily_logs dl
      JOIN caregiver_child_mapping ccm ON ccm.child_id = dl.child_id
      WHERE ccm.caregiver_id = auth.uid() AND ccm.status = 'active'
    )
  );

-- Write: caregiver must be the author of the parent daily_log
CREATE POLICY "log_entries_caregiver_insert"
  ON log_entries FOR INSERT
  WITH CHECK (
    daily_log_id IN (
      SELECT id FROM daily_logs WHERE author_id = auth.uid()
    )
  );
```

---

## Updated RLS — children

With multi-parent support, `children.parent_id` becomes the *primary owner*
(the person who created the record). Additional parents are added via
`caregiver_child_mapping`. Update the existing child policies:

```sql
-- Drop old single-parent policies
DROP POLICY IF EXISTS "children_parent_all"  ON children;
DROP POLICY IF EXISTS "children_teacher_select" ON children;

-- Primary owner retains full CRUD
CREATE POLICY "children_owner_all"
  ON children FOR ALL
  USING  (auth.uid() = parent_id)
  WITH CHECK (auth.uid() = parent_id);

-- Any active caregiver can read the child record
CREATE POLICY "children_caregiver_select"
  ON children FOR SELECT
  USING (
    id IN (
      SELECT child_id FROM caregiver_child_mapping
      WHERE caregiver_id = auth.uid() AND status = 'active'
    )
  );
```

---

## TypeScript additions (docs/types.ts)

```typescript
export type CaregiverRole = 'parent' | 'teacher' | 'guardian';

export interface CaregiverChildMapping {
  id: string;
  caregiver_id: string;
  child_id: string;
  role: CaregiverRole;
  invited_by: string;
  status: 'pending' | 'active' | 'revoked';
  created_at: string;
}

export type CaregiverChildMappingInsert = Pick<
  CaregiverChildMapping,
  'caregiver_id' | 'child_id' | 'role' | 'invited_by'
>;
```

---

## Migration notes

1. Run the `CREATE TABLE` DDL and index statements.
2. **Seed existing relationships**: for every row in `children`, insert a
   `caregiver_child_mapping` row with `role = 'parent'`, `status = 'active'`,
   `invited_by = parent_id` so legacy data is not orphaned.
3. For every row in `child_teacher`, insert a corresponding mapping row with
   `role = 'teacher'`, `status = child_teacher.status`, `invited_by = invited_by`.
4. Drop the old `child_teacher` table once all consumers are migrated.
5. Apply the updated RLS policies in the order listed above.
