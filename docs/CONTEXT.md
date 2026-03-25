# LinkSteps — Architecture Context (Memory Anchor)

> Last updated: 2026-03-24
> Purpose: Prevent logic drift across long sessions. Read this before touching core data or UI.

---

## 1. Role System

Three actor roles. Stored in `profiles.role` (TEXT, CHECK constraint).

| Role       | Icon | Description                              |
|------------|------|------------------------------------------|
| `parent`   | 🏠   | Primary caregiver — full read/write      |
| `teacher`  | 🎒   | School staff — logs behaviour at school  |
| `therapist`| 🧩   | ABA/OT clinician — reads sensitive data  |

`UserRole = 'parent' | 'teacher' | 'therapist'`

Therapist data access is gated by `profiles.shared_metadata_permission JSONB` (parent grants per-field access). Default `{}` = deny all.

---

## 2. Database Schema

### `logs` table (MVP — currently in production)

| Column       | Type        | Notes                                             |
|--------------|-------------|---------------------------------------------------|
| `id`         | UUID        | PK                                                |
| `user_id`    | UUID        | FK → auth.users                                   |
| `mood`       | TEXT        | Human label: `'Very Low'…'Great'`                 |
| `note`       | TEXT        | Optional free-text                                |
| `created_at` | TIMESTAMPTZ | Auto                                              |
| `metadata`   | JSONB       | **Migration pending** — biometric snapshot        |
| `author_name`| TEXT        | **Migration pending** — denormalized display name |
| `author_role`| TEXT        | **Migration pending** — CHECK ('parent','teacher','therapist') |

**Migration SQL (run in Supabase Dashboard → SQL Editor):**
```sql
ALTER TABLE logs
  ADD COLUMN IF NOT EXISTS metadata     JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS author_name  TEXT,
  ADD COLUMN IF NOT EXISTS author_role  TEXT;

ALTER TABLE logs DROP CONSTRAINT IF EXISTS logs_author_role_check;
ALTER TABLE logs ADD CONSTRAINT logs_author_role_check
  CHECK (author_role IN ('parent', 'teacher', 'therapist'));

NOTIFY pgrst, 'reload schema';
```

### `profiles` table (not yet in production)

| Column                       | Type        | Notes                          |
|------------------------------|-------------|--------------------------------|
| `id`                         | UUID        | PK, FK → auth.users            |
| `display_name`               | TEXT        | User's chosen name             |
| `role`                       | TEXT        | CHECK ('parent','teacher','therapist') |
| `child_name`                 | TEXT        | Primary child's name (MVP)     |
| `shared_metadata_permission` | JSONB       | Therapist field-level grants   |
| `created_at`                 | TIMESTAMPTZ | Auto                           |
| `updated_at`                 | TIMESTAMPTZ | Auto                           |

**Migration SQL:**
```sql
CREATE TABLE IF NOT EXISTS profiles (
  id                         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name               TEXT NOT NULL DEFAULT '',
  role                       TEXT NOT NULL DEFAULT 'parent'
                               CHECK (role IN ('parent', 'teacher', 'therapist')),
  child_name                 TEXT,
  shared_metadata_permission JSONB NOT NULL DEFAULT '{}',
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles: owner full access"
  ON profiles FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
NOTIFY pgrst, 'reload schema';
```

### `LogMetadata` JSONB structure

```typescript
interface LogMetadata {
  // Environmental (parent / teacher)
  steps?: number;                  // daily step count
  heart_rate_variability?: number; // ms — higher = better
  sleep_hours?: number;            // last night
  pollen_level?: number;           // 0–10 EPA
  temperature?: number;            // °F
  pressure?: number;               // hPa (~1013 standard)

  // Behavioral (therapist / ABA)
  behavior_tag?: string[];
  behavior_duration_sec?: number;
  behavior_intensity?: 1 | 2 | 3 | 4 | 5;
}
```

---

## 3. Fallback Guard Pattern

PostgREST uses two error codes for missing columns:
- `42703` — PostgreSQL "undefined_column" (SELECT level)
- `PGRST204` — PostgREST schema-cache miss (INSERT/PATCH level)
- `PGRST205` / `42P01` — Table does not exist at all

```typescript
function isMissingColumnError(err) {
  return err?.code === '42703' || err?.code === 'PGRST204';
}
```

**All DB callsites must have a fallback path** when the migration hasn't run.
`saveLog` → tries full insert → falls back to `{user_id, mood, note}`.
`getRecentLogs` → tries full select → falls back to base columns + localStorage profile annotation.

---

## 4. Feature Flags (in `src/app/log/page.tsx`)

| Flag                    | Default | Effect                                               |
|-------------------------|---------|------------------------------------------------------|
| `SHOW_DEMO`             | `false` | Shows OutlookCard with fake triple-threat biometrics |
| `SHOW_TOMORROW_FORECAST`| `true`  | Shows tomorrow's AI forecast card below OutlookCard  |

---

## 5. Today's Outlook Card (OutlookCard)

- Shown when `todayMetadata` is available OR `SHOW_DEMO = true`
- Driven by `generateDailyForecast(metadata, childName)` in `src/lib/predictor.ts`
- Three severity levels: `normal` → `caution` → `warning`
- Three threat levels: `normal` → `elevated` → `critical`
- Left `border-l-4` accent (no full-card backgrounds — low sensory load)
- AM/PM view mode: `🌅 Morning Brief` before noon, `🌇 Afternoon Check-in` after
- Factors: steps, sleep_hours, heart_rate_variability, pollen_level, pressure, temperature

---

## 6. Tomorrow's Forecast Card (TomorrowForecastCard)

- Shown when `SHOW_TOMORROW_FORECAST = true` AND `aiData?.forecast` exists
- Data source: `getAIInsights()` in `mood-log.ts` → calls `/api/ai/insights`
- Compact style for `normal` days, amber `border-l-4` for `caution/warning` days

---

## 7. Author Attribution (Recent Logs)

**Source priority for `author_name`:**
1. `logs.author_name` column (post-migration, per-row)
2. `profiles.display_name` (from DB query in `getRecentLogs`)
3. `localStorage` (`linksteps_profile` key) — set by Settings page
4. `user.user_metadata.full_name` or email prefix (auth fallback)

**Source priority for `author_role`:**
Same cascade. Displayed in `RecentLogs` as:
- `🏠 by [name]` (parent)
- `🎒 by [name]` (teacher)
- `🧩 by [name]` (therapist)

---

## 8. Open TODOs / Fallbacks

| Item                              | Status          | Blocking?    |
|-----------------------------------|-----------------|--------------|
| Run `logs` migration SQL          | Pending (manual)| No — guarded |
| Create `profiles` table           | Pending (manual)| No — localStorage fallback |
| `saveLog` reads profile for author| ✅ Done         | —            |
| `getRecentLogs` profile annotation| ✅ Done         | —            |
| Settings page (display_name, role)| ✅ Done (this PR)| —           |
| `child_name` used in OutlookCard  | TODO            | No           |
| Multi-child support               | TODO (post-MVP) | No           |
| Therapist permission gating       | TODO (post-MVP) | No           |

---

## 9. Key File Map

| File                                | Purpose                                    |
|-------------------------------------|--------------------------------------------|
| `src/app/log/page.tsx`              | Main daily log page (all widgets)          |
| `src/app/settings/page.tsx`         | Identity & kid settings                    |
| `src/app/insights/page.tsx`         | Weekly analytics                           |
| `src/lib/mood-log.ts`               | All DB helpers (saveLog, getRecentLogs…)   |
| `src/lib/predictor.ts`              | Biometric forecast engine (pure function)  |
| `src/components/ui/mood-card.tsx`   | Main mood input card                       |
| `src/components/ui/recent-logs.tsx` | Timeline log list with author badges       |
| `src/components/ui/app-nav.tsx`     | Fixed bottom nav (Log / Insights)          |
| `src/middleware.ts`                 | Session refresh + route protection         |
| `docs/CONTEXT.md`                   | This file — architecture memory anchor     |
