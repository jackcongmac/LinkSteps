# Sleep Insights Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Sleep Insights card to the Carer Dashboard that shows Mom's real-time sleep state at night and a morning summary with a Deep/Light/REM breakdown bar.

**Architecture:** A new `sleep_sessions` table stores one row per night with a `current_state` column for live Night Owl Watch (22:00–06:00 BJ) and completion totals for Morning Summary. The health simulator is extended to seed a "last night" row on startup and cycle states during night hours. The `SleepInsightsCard` component is added inline in `carer/page.tsx` between `StatusHeader` and `WellnessCard`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict (no `any`), Tailwind CSS, Supabase (Postgres + Realtime `postgres_changes`), inline `supabase-js` client.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260331_sleep_sessions.sql` | **Create** | Table DDL + RLS policies + Realtime publication |
| `src/lib/health-simulator.ts` | **Modify** | Add Beijing date helpers + `seedLastNight()` + `tickSleepState()` |
| `src/app/carer/page.tsx` | **Modify** | Add `SleepSession` type, state, fetch, realtime sub, `SleepInsightsCard` component, JSX placement, wellness wire |

---

## Task 1: DB Migration — `sleep_sessions` table

**Files:**
- Create: `supabase/migrations/20260331_sleep_sessions.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260331_sleep_sessions.sql` with this exact content:

```sql
-- Sleep Sessions — one row per night per senior
-- current_state is non-null during an active session, null once completed.
-- RLS: creator full access (covers simulator writes), carers can read.

CREATE TABLE sleep_sessions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id      uuid        NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
  session_date   date        NOT NULL,
  started_at     timestamptz,
  ended_at       timestamptz,
  current_state  text        CHECK (current_state IN ('awake', 'light', 'deep')),
  total_hours    float,
  deep_hours     float,
  light_hours    float,
  rem_hours      float,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (senior_id, session_date)
);

ALTER TABLE sleep_sessions ENABLE ROW LEVEL SECURITY;

-- Creator (the user who owns the senior_profile) has full access.
-- This covers the simulator, which runs as the creator user in the browser.
CREATE POLICY "sleep_sessions: creator full access"
  ON sleep_sessions
  FOR ALL
  USING (
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  )
  WITH CHECK (
    senior_id IN (
      SELECT id FROM senior_profiles WHERE created_by = auth.uid()
    )
  );

-- Linked carers can read sessions for their seniors
CREATE POLICY "sleep_sessions: carers can read"
  ON sleep_sessions
  FOR SELECT
  USING (
    senior_id IN (
      SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid()
    )
  );

-- Realtime: enable UPDATE events so the carer dashboard receives live state changes
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

- [ ] **Step 2: Run the migration in Supabase Dashboard**

Go to **Supabase Dashboard → SQL Editor**, paste the entire file content, click **Run**.

Expected: no errors, message "Success. No rows returned."

- [ ] **Step 3: Verify the table exists**

In Supabase Dashboard → **Table Editor**: confirm `sleep_sessions` appears with all columns.

In SQL Editor, run:
```sql
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```
Expected: `sleep_sessions` appears in the results.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260331_sleep_sessions.sql
git commit -m "feat: add sleep_sessions table with RLS and Realtime"
```

---

## Task 2: Extend health simulator with sleep logic

**Files:**
- Modify: `src/lib/health-simulator.ts`

Read the current file before editing. The current file has `startHealthSimulator(supabase, seniorId)` which ticks every 30s and writes `heart_rate` + `steps` rows to `health_metrics`.

You will add three things:
1. Beijing date helpers (pure functions, no Supabase)
2. `seedLastNight()` — upserts a completed last-night row once on startup
3. `tickSleepState()` — called on each 30s tick, cycles state during night hours (22:00–06:00 BJ)

- [ ] **Step 1: Replace the entire file with the extended version**

```typescript
// src/lib/health-simulator.ts
// Inserts into health_metrics using the vertical schema:
//   (senior_id, metric_type, value, measured_at)
// Two rows per tick — one for heart_rate, one for steps.
//
// Also manages sleep_sessions:
//   - Seeds a "last night" completed row on startup
//   - During 22:00–06:00 Beijing time: upserts an active row and cycles current_state

import type { SupabaseClient } from "@supabase/supabase-js";

const INTERVAL_MS = 30_000;

// ── Beijing date helpers ──────────────────────────────────────

/** Returns today's date string and current hour in Beijing timezone */
function getBjDate(): { dateStr: string; hour: number } {
  const bj = new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
  const d  = new Date(bj);
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return { dateStr: `${y}-${mo}-${dd}`, hour: d.getHours() };
}

/** Returns yesterday's date string in Beijing timezone */
function getYesterdayBj(): string {
  const bj = new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
  const d  = new Date(bj);
  d.setDate(d.getDate() - 1);
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dd}`;
}

/**
 * Converts a Beijing local date + HH:MM into a UTC ISO string.
 * Beijing is UTC+8, so we subtract 8 hours.
 */
function bjLocalToISO(dateStr: string, hh: number, mm: number): string {
  const [y, mo, dd] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, dd, hh - 8, mm)).toISOString();
}

// ── Sleep simulator ───────────────────────────────────────────

type SleepState = 'awake' | 'light' | 'deep';

const SLEEP_CYCLE: SleepState[] = ['awake', 'light', 'deep', 'light', 'deep', 'light', 'deep'];
let sleepStateIdx    = 0;
let nightSessionLive = false;   // true once we've upserted started_at for tonight
let nightSessionDate = "";      // stored so post-midnight ticks use the correct date

/**
 * Upserts a completed "last night" sleep session.
 * Safe to call multiple times — UNIQUE (senior_id, session_date) prevents duplicates.
 */
async function seedLastNight(
  supabase: SupabaseClient,
  seniorId: string,
): Promise<void> {
  const yesterday      = getYesterdayBj();
  const { dateStr: today } = getBjDate();

  const startedAt = bjLocalToISO(yesterday, 22, 30);  // 22:30 BJ last night
  const endedAt   = bjLocalToISO(today,     6,  15);  // 06:15 BJ this morning

  const { error } = await supabase
    .from("sleep_sessions")
    .upsert(
      {
        senior_id:     seniorId,
        session_date:  yesterday,
        started_at:    startedAt,
        ended_at:      endedAt,
        current_state: null,
        total_hours:   6.5,
        deep_hours:    1.8,
        light_hours:   3.2,
        rem_hours:     1.5,
      },
      { onConflict: "senior_id,session_date" },
    );

  if (error) {
    console.error("[HealthSimulator] sleep seed failed:", error.message);
  } else {
    console.log("[HealthSimulator] ✓ sleep seed: last night 6.5h (deep 1.8 / light 3.2 / REM 1.5)");
  }
}

/**
 * Called when morning arrives (first tick when hour >= 6 and a live session exists).
 * Sets ended_at, clears current_state, writes approximate hour totals.
 */
async function completeNightSession(
  supabase: SupabaseClient,
  seniorId: string,
  sessionDate: string,
): Promise<void> {
  const { error } = await supabase
    .from("sleep_sessions")
    .update({
      ended_at:      new Date().toISOString(),
      current_state: null,
      total_hours:   7.0,
      deep_hours:    2.0,
      light_hours:   3.5,
      rem_hours:     1.5,
    })
    .eq("senior_id", seniorId)
    .eq("session_date", sessionDate)
    .is("ended_at", null);   // only update if still active

  if (error) {
    console.error("[HealthSimulator] sleep complete failed:", error.message);
  } else {
    console.log("[HealthSimulator] ✓ sleep session completed");
  }
}

/**
 * Called on each 30s tick.
 * During 22:00–05:59 Beijing: upserts/updates the active sleep session.
 * At 06:00+: completes the active session, then resets.
 *
 * MIDNIGHT BOUNDARY: A session started at 23:xx has session_date = that day's date.
 * After midnight (hour 00–05), getBjDate() returns the next day's date. We avoid this
 * by storing `nightSessionDate` on the first tick and reusing it for all subsequent
 * ticks within the same continuous night, regardless of calendar rollover.
 */
async function tickSleepState(
  supabase: SupabaseClient,
  seniorId: string,
): Promise<void> {
  const { dateStr, hour } = getBjDate();
  const isNight = hour >= 22 || hour < 6;

  if (!isNight) {
    // First daytime tick — complete any lingering active session then reset
    if (nightSessionLive && nightSessionDate) {
      await completeNightSession(supabase, seniorId, nightSessionDate);
    }
    nightSessionLive = false;
    nightSessionDate = "";
    sleepStateIdx    = 0;
    return;
  }

  // For 22:xx the session belongs to today; for 00:xx–05:xx it belongs to yesterday
  // (the night started before midnight). If a session is already live we use the
  // stored date; if starting fresh we pick the correct anchor date.
  const anchorDate = hour >= 22 ? dateStr : getYesterdayBj();

  const state = SLEEP_CYCLE[sleepStateIdx % SLEEP_CYCLE.length];
  sleepStateIdx++;

  if (!nightSessionLive) {
    // First tick of this night — INSERT (or upsert) with started_at
    const { error } = await supabase
      .from("sleep_sessions")
      .upsert(
        {
          senior_id:     seniorId,
          session_date:  anchorDate,
          started_at:    new Date().toISOString(),
          ended_at:      null,
          current_state: state,
        },
        { onConflict: "senior_id,session_date" },
      );

    if (error) {
      console.error("[HealthSimulator] sleep tick (start) failed:", error.message);
    } else {
      nightSessionLive = true;
      nightSessionDate = anchorDate;   // store so post-midnight ticks use the right date
      console.log(`[HealthSimulator] ✓ sleep session started: ${state} (date=${anchorDate})`);
    }
  } else {
    // Subsequent ticks — only update current_state, using the stored session date
    const { error } = await supabase
      .from("sleep_sessions")
      .update({ current_state: state })
      .eq("senior_id", seniorId)
      .eq("session_date", nightSessionDate);

    if (error) {
      console.error("[HealthSimulator] sleep tick (update) failed:", error.message);
    } else {
      console.log(`[HealthSimulator] ✓ sleep state: ${state}`);
    }
  }
}

// ── Main simulator ────────────────────────────────────────────

export function startHealthSimulator(
  supabase: SupabaseClient,
  seniorId: string,
): () => void {
  const hour = new Date().getHours();
  let cumulativeSteps = Math.round(4500 * Math.min(hour / 18, 1));

  const tick = async () => {
    const now       = new Date().toISOString();
    const isSpike   = Math.random() < 0.05;
    const heartRate = isSpike
      ? Math.round(121 + Math.random() * 20)
      : Math.round(65  + Math.random() * 20);

    cumulativeSteps += Math.round(20 + Math.random() * 100);

    // Insert heart_rate row
    const { error: hrErr } = await supabase
      .from("health_metrics")
      .insert({ senior_id: seniorId, metric_type: "heart_rate", value: heartRate, measured_at: now });

    if (hrErr) {
      console.error("[HealthSimulator] heart_rate insert failed:", hrErr.message, hrErr.details);
    }

    // Insert steps row
    const { error: stepsErr } = await supabase
      .from("health_metrics")
      .insert({ senior_id: seniorId, metric_type: "steps", value: cumulativeSteps, measured_at: now });

    if (stepsErr) {
      console.error("[HealthSimulator] steps insert failed:", stepsErr.message, stepsErr.details);
    }

    if (!hrErr && !stepsErr) {
      console.log(`[HealthSimulator] ✓ HR=${heartRate} bpm  steps=${cumulativeSteps}`);
    }

    // Sleep state tick (no-ops outside 22:00–06:00 BJ)
    await tickSleepState(supabase, seniorId);
  };

  // Seed last night's completed session immediately
  seedLastNight(supabase, seniorId);

  tick();
  const id = setInterval(tick, INTERVAL_MS);
  return () => clearInterval(id);
}
```

- [ ] **Step 2: Verify in the browser console**

Open the app on the senior-home page (where `startHealthSimulator` is called). Open DevTools → Console. Look for:

```
[HealthSimulator] ✓ sleep seed: last night 6.5h (deep 1.8 / light 3.2 / REM 1.5)
```

If it's 22:00–06:00 Beijing, also look for:
```
[HealthSimulator] ✓ sleep session started: awake
```

If you see errors, check: RLS policy was applied (Task 1), the `sleep_sessions` table exists.

- [ ] **Step 3: Verify data in Supabase Dashboard**

In **Table Editor → sleep_sessions**, confirm a row exists for yesterday's date with `ended_at` set and `total_hours = 6.5`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/health-simulator.ts
git commit -m "feat: extend health simulator with sleep session seed and night owl tick"
```

---

## Task 3: Carer Dashboard — state, fetch, and Realtime subscription

**Files:**
- Modify: `src/app/carer/page.tsx` (lines ~109–122 for types, ~600–677 for loadData, ~692–760 for realtime useEffect)

This task adds the data layer. The UI component comes in Task 4.

- [ ] **Step 1: Add the `SleepSession` interface**

After the `HealthData` interface (around line 122), add:

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
```

- [ ] **Step 2: Add `sleepSession` state**

In the component's state block (around line 605, after `healthData` state), add:

```typescript
const [sleepSession, setSleepSession] = useState<SleepSession | null>(null);
```

- [ ] **Step 3: Add sleep fetch inside `loadData`**

Inside `loadData`, after the `health_metrics` fetch block (around line 676), add this inside the `if (id) { ... }` block:

```typescript
// Fetch latest sleep session (today or yesterday — within last 2 days BJ time)
const bjToday = new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
const bjDate  = new Date(bjToday);
bjDate.setDate(bjDate.getDate() - 1);
const cutoff  = `${bjDate.getFullYear()}-${String(bjDate.getMonth() + 1).padStart(2, "0")}-${String(bjDate.getDate()).padStart(2, "0")}`;

const { data: sleepRows, error: sleepError } = await supabase
  .from("sleep_sessions")
  .select("id, session_date, started_at, ended_at, current_state, total_hours, deep_hours, light_hours, rem_hours")
  .eq("senior_id", id)
  .gte("session_date", cutoff)
  .order("session_date", { ascending: false })
  .limit(1);

if (sleepError) {
  console.error("[carer] sleep_sessions query failed:", sleepError.message);
}
if (sleepRows && sleepRows.length > 0) {
  setSleepSession(sleepRows[0] as SleepSession);
}
```

- [ ] **Step 4: Add sleep_sessions UPDATE subscription**

In the existing `useEffect` realtime block (the one with `supabase.channel("carer-dashboard")`), add a new `.on()` call after the `health_metrics` subscription (around line 753, before `.subscribe()`):

```typescript
.on(
  "postgres_changes",
  { event: "UPDATE", schema: "public", table: "sleep_sessions" },
  (payload: RealtimePostgresUpdatePayload<SleepSession & { senior_id: string }>) => {
    const updated = payload.new;
    if (updated.senior_id !== seniorId) return;
    setSleepSession(updated);
    console.log(`[sleep-realtime] state=${updated.current_state ?? "ended"}`);
  },
)
.on(
  "postgres_changes",
  { event: "INSERT", schema: "public", table: "sleep_sessions" },
  (payload: RealtimePostgresInsertPayload<SleepSession & { senior_id: string }>) => {
    const row = payload.new;
    if (row.senior_id !== seniorId) return;
    setSleepSession(row);
  },
)
```

- [ ] **Step 5: Wire sleep hours into wellness calculation**

Find this line (around line 803):
```typescript
sleep:     6.5,   // TODO: replace with DB sleep field from health_metrics
```

Replace it with:
```typescript
sleep:     sleepSession?.total_hours ?? 6.5,
```

- [ ] **Step 6: Verify in browser console**

Reload the carer dashboard. Open DevTools → Console. Confirm no TypeScript errors (Next.js will show them inline). In Supabase Dashboard, manually UPDATE a `sleep_sessions` row's `current_state` to `'deep'`. Within seconds, the console should show:
```
[sleep-realtime] state=deep
```

- [ ] **Step 7: Commit**

```bash
git add src/app/carer/page.tsx
git commit -m "feat: add sleep session state, fetch, and realtime subscription to carer dashboard"
```

---

## Task 4: `SleepInsightsCard` component and dashboard placement

**Files:**
- Modify: `src/app/carer/page.tsx`

This task adds the visual card component and places it in the JSX.

- [ ] **Step 1: Add helper sub-components before `WellnessCard`**

Find the `// ── WellnessCard ──` comment (around line 456). Insert these two helper components immediately before it:

```typescript
// ── SleepInsightsCard helpers ─────────────────────────────────

function SleepStateChip({ state }: { state: 'awake' | 'light' | 'deep' | null }) {
  if (!state) return <span className="text-slate-500 text-sm">--</span>;

  const config: Record<
    'awake' | 'light' | 'deep',
    { label: string; cls: string; animate: boolean }
  > = {
    deep:  {
      label: '正在深睡',
      cls:   'bg-indigo-500/40 text-indigo-200 ring-1 ring-indigo-400/50',
      animate: true,
    },
    light: {
      label: '浅睡中',
      cls:   'bg-sky-500/30 text-sky-200',
      animate: false,
    },
    awake: {
      label: '尚未入睡',
      cls:   'bg-slate-700 text-slate-400',
      animate: false,
    },
  };

  const c = config[state];
  return (
    <span
      className={["px-4 py-2 rounded-full text-base font-medium", c.cls].join(" ")}
      style={c.animate ? { animation: 'breathe 4s ease-in-out infinite' } : undefined}
    >
      {c.label}
    </span>
  );
}

function SleepBreakdownBar({ session }: { session: SleepSession }) {
  const total = session.total_hours ?? 0;
  if (total === 0) return null;

  const deepPct  = (((session.deep_hours  ?? 0) / total) * 100).toFixed(1);
  const lightPct = (((session.light_hours ?? 0) / total) * 100).toFixed(1);
  const remPct   = (((session.rem_hours   ?? 0) / total) * 100).toFixed(1);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-700">
        <div className="bg-indigo-400 transition-all" style={{ width: `${deepPct}%` }} />
        <div className="bg-sky-400 transition-all"    style={{ width: `${lightPct}%` }} />
        <div className="bg-violet-400 transition-all" style={{ width: `${remPct}%` }} />
      </div>
      <div className="flex gap-2 text-[11px] text-slate-400">
        <span>深睡 {session.deep_hours?.toFixed(1)}h</span>
        <span>·</span>
        <span>浅睡 {session.light_hours?.toFixed(1)}h</span>
        <span>·</span>
        <span>REM {session.rem_hours?.toFixed(1)}h</span>
      </div>
    </div>
  );
}

// ── SleepInsightsCard ─────────────────────────────────────────

interface SleepInsightsCardProps {
  session: SleepSession | null;
}

function SleepInsightsCard({ session }: SleepInsightsCardProps) {
  const isNightWatch    = session !== null && session.ended_at === null;
  const isMorningSummary = session !== null && session.ended_at !== null;

  const startedAtBj = session?.started_at
    ? new Date(session.started_at).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour:     "2-digit",
        minute:   "2-digit",
        hour12:   false,
      })
    : null;

  const deepWarn = isMorningSummary && (session.deep_hours ?? 0) < 1.5;

  return (
    <div
      className="rounded-3xl shadow-lg px-5 py-5 flex flex-col gap-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)' }}
    >
      {/* Stars decoration */}
      <span className="absolute top-3 right-6  w-1   h-1   rounded-full bg-white opacity-70" />
      <span className="absolute top-6 right-12 w-0.5 h-0.5 rounded-full bg-white opacity-40" />
      <span className="absolute top-4 right-20 w-1   h-1   rounded-full bg-white opacity-50" />
      <span className="absolute top-8 right-8  w-0.5 h-0.5 rounded-full bg-white opacity-30" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🌙</span>
          <p className="text-white font-semibold text-base">
            {isNightWatch ? '夜间监测' : '昨晚睡眠'}
          </p>
        </div>
        {isNightWatch && (
          <span className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-indigo-400/50 text-indigo-200">
            实时睡眠状态
          </span>
        )}
      </div>

      {/* Body */}
      {!session ? (
        <p className="text-slate-500 text-sm">暂无睡眠数据</p>
      ) : isNightWatch ? (
        <div className="flex flex-col items-center gap-3 py-2">
          <SleepStateChip state={session.current_state} />
          {startedAtBj && (
            <p className="text-slate-400 text-xs">入睡时间 {startedAtBj}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className={["text-2xl font-bold", deepWarn ? "text-amber-300" : "text-white"].join(" ")}>
            昨晚总睡眠: {session.total_hours?.toFixed(1)}小时
            {deepWarn && <span className="ml-2 text-sm font-normal text-amber-400">深睡不足</span>}
          </p>
          <SleepBreakdownBar session={session} />
        </div>
      )}

      {/* Footer */}
      <p className="text-[10px] text-slate-600 text-right -mt-1">
        基于睡眠模拟数据 · Huawei Health 接入后自动更新
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Place the card in JSX**

Find the `{/* ── Status header ── */}` block in the JSX (around line 837). The current layout is:

```tsx
{/* ── Status header ── */}
<StatusHeader ... />

{/* ── AI wellness analysis ── */}
<WellnessCard wellness={wellness} loading={bjWeatherLoad && !healthData} />
```

Add the Sleep card between them:

```tsx
{/* ── Status header ── */}
<StatusHeader
  status={status}
  pulse={pulse}
  onPulseEnd={() => setPulse(false)}
  onDismiss={() => setDismissedId(status.itemId)}
  healthData={healthData}
/>

{/* ── Sleep insights (Vitals Cluster) ── */}
<SleepInsightsCard session={sleepSession} />

{/* ── AI wellness analysis ── */}
<WellnessCard wellness={wellness} loading={bjWeatherLoad && !healthData} />
```

- [ ] **Step 3: Verify the card renders**

Open the carer dashboard in the browser. Confirm:
- A dark purple/black card appears between the green StatusHeader and the white WellnessCard
- The card shows "昨晚总睡眠: 6.5小时" with the Deep/Light/REM bar (from the seeded data)
- If `deep_hours = 1.8` (≥ 1.5) the total is in white text (not amber)

If it's 22:00–06:00 Beijing, the card should show "夜间监测" and a state badge instead.

- [ ] **Step 4: Test Realtime state update**

In Supabase Dashboard → SQL Editor, run:
```sql
UPDATE sleep_sessions
SET current_state = 'deep', ended_at = NULL
WHERE session_date = (SELECT MAX(session_date) FROM sleep_sessions);
```

Within ~2 seconds the card should update to show "正在深睡" with the breathing animation.

Then restore for morning summary:
```sql
UPDATE sleep_sessions
SET current_state = NULL, ended_at = now()
WHERE session_date = (SELECT MAX(session_date) FROM sleep_sessions);
```

Card should switch to Morning Summary view.

- [ ] **Step 5: Verify amber warning**

In Supabase Dashboard → SQL Editor, run:
```sql
UPDATE sleep_sessions
SET deep_hours = 1.2
WHERE session_date = (SELECT MAX(session_date) FROM sleep_sessions);
```

The total hours text should turn amber and show "深睡不足".

Restore:
```sql
UPDATE sleep_sessions SET deep_hours = 1.8
WHERE session_date = (SELECT MAX(session_date) FROM sleep_sessions);
```

- [ ] **Step 6: Verify wellness score uses real sleep data**

Open DevTools Console. The wellness score should now be computing with `sleep: 6.5` (from the DB row, not hardcoded). Try running:
```sql
UPDATE sleep_sessions SET total_hours = 4.0 WHERE session_date = (SELECT MAX(session_date) FROM sleep_sessions);
```

The WellnessCard advice should shift to mention poor sleep (Rule 5: sleep < 6h → "老妈昨晚睡眠不足…"). Restore with `SET total_hours = 6.5`.

- [ ] **Step 7: Commit**

```bash
git add src/app/carer/page.tsx
git commit -m "feat: add SleepInsightsCard with night owl watch and morning summary"
```

---

## Final Verification Checklist

Before declaring done, confirm all of:

- [ ] `sleep_sessions` table exists with correct schema (Supabase Dashboard)
- [ ] `sleep_sessions` appears in `supabase_realtime` publication
- [ ] Console shows `[HealthSimulator] ✓ sleep seed: last night 6.5h` on page load
- [ ] Dark card appears between StatusHeader and WellnessCard on carer dashboard
- [ ] Morning Summary shows total hours + breakdown bar
- [ ] Amber highlight appears when `deep_hours < 1.5`
- [ ] Realtime UPDATE changes card state within 2 seconds
- [ ] WellnessCard advice changes when `total_hours` drops below 6

---

## Non-goals (do not implement)

- Huawei Health API integration
- Historical sleep trend chart
- Push notifications when state changes
- Filling in the `tel:` href for "立即拨打妈妈" (pre-existing TODO)
