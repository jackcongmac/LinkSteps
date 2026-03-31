# Sleep Insights Module — Design Spec

**Date:** 2026-03-31
**Feature:** Sleep Insights card on Carer Dashboard
**Status:** Approved

---

## Goal

Add a Sleep Insights module to the Carer Dashboard that shows Mom's real-time sleep state during the night (22:00–06:00 Beijing) and a morning summary once she wakes up. Sleep data lives in a dedicated `sleep_sessions` table and is driven by the health simulator for MVP, with Huawei Health sync as the future production path.

## Architecture

Three components working together:

1. **`sleep_sessions` DB table** — one row per night; holds live `current_state` for Night Owl Watch and completed totals (deep/light/REM) for Morning Summary.
2. **Simulator extension** (`src/lib/health-simulator.ts`) — inserts a completed "last night" row on startup for immediate demo; during 22:00–06:00 BJ creates/updates an active session row with `current_state` cycling through states.
3. **`SleepInsightsCard` component** (inline in `src/app/carer/page.tsx`) — placed between `StatusHeader` and `WellnessCard`; also feeds real `total_hours` into the WellnessCard wellness score, replacing the hardcoded 6.5h placeholder.

## Database

### `sleep_sessions` table

```sql
CREATE TABLE sleep_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id      uuid NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
  session_date   date NOT NULL,
  started_at     timestamptz,
  ended_at       timestamptz,            -- NULL = session still active
  current_state  text CHECK (current_state IN ('awake', 'light', 'deep')),
                                          -- NULL once session ends
  total_hours    float,
  deep_hours     float,
  light_hours    float,
  rem_hours      float,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (senior_id, session_date)
);

ALTER TABLE sleep_sessions ENABLE ROW LEVEL SECURITY;

-- Creator full access
CREATE POLICY "sleep_sessions: creator full access"
  ON sleep_sessions FOR ALL
  USING (
    senior_id IN (SELECT id FROM senior_profiles WHERE created_by = auth.uid())
  )
  WITH CHECK (
    senior_id IN (SELECT id FROM senior_profiles WHERE created_by = auth.uid())
  );

-- Linked carers can read
CREATE POLICY "sleep_sessions: carers can read"
  ON sleep_sessions FOR SELECT
  USING (
    senior_id IN (
      SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid()
    )
  );

-- NOTE: INSERT and UPDATE are covered by "creator full access" above.
-- No extra permissive policies needed — the simulator runs as the creator user.

-- Enable Realtime (idempotent guard, same pattern as health_metrics migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'sleep_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sleep_sessions;
  END IF;
END $$;
```

### Migration file

`supabase/migrations/20260331_sleep_sessions.sql`

## Simulator Additions (`src/lib/health-simulator.ts`)

On startup (inside the existing `startHealthSimulator` function, immediately after the health tick setup):

1. **Seed "last night" completed row** — `UPSERT` with:
   - `session_date`: yesterday's date (Beijing timezone)
   - `started_at`: yesterday 22:30 BJ
   - `ended_at`: today 06:15 BJ
   - `total_hours: 6.5`, `deep_hours: 1.8`, `light_hours: 3.2`, `rem_hours: 1.5`
   - `current_state: null`

2. **Night Owl active session** — each health tick (30s), if current BJ hour is 22–23 or 0–5:
   - `UPSERT` row for today's `session_date` with `ended_at: null`
   - First tick of the night: `current_state = 'awake'`
   - Subsequent ticks: randomly cycle `awake → light → deep → light → deep` (weights: awake 10%, light 45%, deep 45%)
   - At BJ hour 6+: set `ended_at`, clear `current_state`, compute and set totals

## Carer Dashboard Changes (`src/app/carer/page.tsx`)

### New state

```typescript
interface SleepSession {
  id:            string;
  session_date:  string;
  started_at:    string | null;
  ended_at:      string | null;
  current_state: 'awake' | 'light' | 'deep' | null;
  total_hours:   number | null;
  deep_hours:    number | null;
  light_hours:   number | null;
  rem_hours:     number | null;
}

const [sleepSession, setSleepSession] = useState<SleepSession | null>(null);
```

### Data fetch

On mount (alongside existing health_metrics fetch): query `sleep_sessions` for `seniorId`, filtered to `session_date >= today - 1 day (Beijing timezone)`, ordered by `session_date DESC`, limit 1. The date filter prevents a stale ancient row from displaying as "last night" before the simulator has run.

### Realtime subscription

Subscribe to `postgres_changes` on `sleep_sessions` for `UPDATE` and `INSERT` events filtered by `senior_id`. On event: update `sleepSession` state in place.

### WellnessCard integration

Replace `sleep: 6.5` with:
```typescript
sleep: sleepSession?.total_hours ?? 6.5
```

### Layout position

Placed between `StatusHeader` and `WellnessCard` in JSX.

## `SleepInsightsCard` Component

### Props

```typescript
interface SleepInsightsCardProps {
  session: SleepSession | null;
}
```

### Mode logic

- **Night Owl Watch mode**: `session.ended_at === null` (active session)
- **Morning Summary mode**: `session.ended_at !== null` (completed session)
- **No data**: show skeleton / "--" state

### Visual Theme — Dark Night Sky

```
Background:  bg-gradient-to-br from-slate-900 to-indigo-950
Text:        text-white / text-indigo-200 / text-slate-400
Shadow:      shadow-lg (no border, card "floats")
Stars:       3–4 × <span class="absolute w-1 h-1 rounded-full bg-white opacity-[0.3/0.5/0.7]">
             scattered in top-right corner via absolute positioning
```

Contrast purpose: StatusHeader and WellnessCard are white cards with green/indigo accents. The dark sleep card creates an immediate "night dimension" visual break.

### Night Owl Watch UI

```
Header:  🌙  夜间监测         [实时睡眠状态 badge — indigo outline]
Body:    Current state badge (large, centered)
         深睡中   → bg-indigo-500/40  text-indigo-200  ring-indigo-400/50  + breathe animation
         浅睡中   → bg-sky-500/30     text-sky-200
         尚未入睡 → bg-slate-700      text-slate-400
Footer:  入睡时间 23:14  (if started_at is set)
```

### Morning Summary UI

```
Header:  🌙  昨晚睡眠
Body:    昨晚总睡眠: X.X 小时
         — total_hours text is AMBER (text-amber-300) if deep_hours < 1.5
         — otherwise WHITE
Breakdown bar (full width):
  Track:   bg-slate-700  rounded-full  h-2.5
  Segments (proportional to hours / total_hours):
    Deep  → bg-indigo-400
    Light → bg-sky-400
    REM   → bg-violet-400
Legend:  Deep X.Xh  ·  Light X.Xh  ·  REM X.Xh  (text-xs text-slate-400)
```

### Amber advice trigger

If `deep_hours < 1.5` AND the WellnessCard's wellness level is `good` or better, the WellnessCard advice should downgrade to include a sleep note. This is handled by passing real `total_hours` (which is low when deep sleep is poor) into `calculateSeniorWellness` — Rule 5 (sleep < 6h) or the morning context already triggers `alert` advice naturally.

## File Summary

| File | Change |
|---|---|
| `supabase/migrations/20260331_sleep_sessions.sql` | New — table + RLS + realtime |
| `src/lib/health-simulator.ts` | Extend — seed last night + night owl tick logic |
| `src/app/carer/page.tsx` | Add `sleepSession` state, fetch, realtime sub, `SleepInsightsCard` component, layout position, wire sleep hours into wellness score |

## Non-goals (MVP)

- No Huawei Health API integration (simulator only)
- No historical sleep trend chart
- No notification/push when state changes
- Phone number for "立即拨打妈妈" still needs a real value (pre-existing TODO)
