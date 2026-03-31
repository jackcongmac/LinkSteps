// src/lib/health-simulator.ts
// Inserts into health_metrics using the vertical schema:
//   (senior_id, metric_type, value, measured_at)
// Two rows per tick — one for heart_rate, one for steps.
//
// Also manages sleep_sessions:
//   - Seeds a "last night" completed row on startup
//   - During 22:00–06:00 Beijing time: upserts an active row and cycles current_state
//
// All DB payloads use `as any` to hard-bypass the Supabase JS client's
// schema-cache type narrowing.  This is intentional — the schema cache
// on the PostgREST side may lag behind recent ALTER TABLE migrations.

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  // hh - 8 may be negative (e.g. 06:15 BJ → hh=6 → -2 UTC).
  // Date.UTC correctly rolls back the day for negative hours.
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

  const { error } = await (supabase as any)
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
      { onConflict: "senior_id,session_date", ignoreDuplicates: true },
    );

  if (error) {
    console.error("[HealthSimulator] sleep seed failed:", error.message, error.details, error.hint);
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
  const { error } = await (supabase as any)
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
    console.error("[HealthSimulator] sleep complete failed:", error.message, error.details, error.hint);
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
    const { error } = await (supabase as any)
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
      console.error("[HealthSimulator] sleep tick (start) failed:", error.message, error.details, error.hint);
    } else {
      nightSessionLive = true;
      nightSessionDate = anchorDate;   // store so post-midnight ticks use the right date
      console.log(`[HealthSimulator] ✓ sleep session started: ${state} (date=${anchorDate})`);
    }
  } else {
    // Subsequent ticks — only update current_state, using the stored session date
    const { error } = await (supabase as any)
      .from("sleep_sessions")
      .update({ current_state: state })
      .eq("senior_id", seniorId)
      .eq("session_date", nightSessionDate);

    if (error) {
      console.error("[HealthSimulator] sleep tick (update) failed:", error.message, error.details, error.hint);
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
  // Reset module-level sleep state so the function is reentrant
  // (handles hot-reload during development and seniorId changes).
  sleepStateIdx    = 0;
  nightSessionLive = false;
  nightSessionDate = "";

  const hour = new Date().getHours();
  let cumulativeSteps = Math.round(4500 * Math.min(hour / 18, 1));

  const tick = async () => {
    const now       = new Date().toISOString();
    const isSpike   = Math.random() < 0.05;
    const heartRate = isSpike
      ? Math.round(121 + Math.random() * 20)
      : Math.round(65  + Math.random() * 20);

    cumulativeSteps += Math.round(20 + Math.random() * 100);

    // Insert heart_rate row — cast to any to hard-bypass schema-cache validation
    const { error: hrErr } = await (supabase as any)
      .from("health_metrics")
      .insert({ senior_id: seniorId, metric_type: "heart_rate", value: heartRate, measured_at: now });

    if (hrErr) {
      console.error("[HealthSimulator] heart_rate insert failed:", hrErr.message, hrErr.details, hrErr.hint);
    }

    // Insert steps row
    const { error: stepsErr } = await (supabase as any)
      .from("health_metrics")
      .insert({ senior_id: seniorId, metric_type: "steps", value: cumulativeSteps, measured_at: now });

    if (stepsErr) {
      console.error("[HealthSimulator] steps insert failed:", stepsErr.message, stepsErr.details, stepsErr.hint);
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
