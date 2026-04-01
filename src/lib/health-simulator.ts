// src/lib/health-simulator.ts
// Inserts into health_metrics using the vertical schema:
//   (senior_id, metric_type, value, measured_at)
// Two rows per tick — one for heart_rate, one for steps.
//
// sleep_sessions writes are intentionally minimal:
//   Only columns known to be in the PostgREST schema cache are written.
//   current_state / ended_at are omitted until schema cache is refreshed
//   (Supabase Dashboard → Settings → API → Reload schema cache).

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SupabaseClient } from "@supabase/supabase-js";

const INTERVAL_MS = 30_000;

// ── Beijing date helpers ──────────────────────────────────────

function getBjDate(): { dateStr: string; hour: number } {
  const bj = new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
  const d  = new Date(bj);
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return { dateStr: `${y}-${mo}-${dd}`, hour: d.getHours() };
}

function getYesterdayBj(): string {
  const bj = new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
  const d  = new Date(bj);
  d.setDate(d.getDate() - 1);
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dd}`;
}

// ── Sleep simulator ───────────────────────────────────────────

let sleepStateIdx    = 0;
let nightSessionLive = false;
let nightSessionDate = "";

/**
 * Seeds a completed "last night" row — only original table columns used.
 * started_at / ended_at / current_state omitted (not in PostgREST schema cache).
 * Always overwrites so stale/partial rows from prior failed attempts get fixed.
 */
async function seedLastNight(
  supabase: SupabaseClient,
  seniorId: string,
): Promise<void> {
  const yesterday = getYesterdayBj();

  const { error } = await (supabase as any)
    .from("sleep_sessions")
    .upsert(
      {
        senior_id:    seniorId,
        session_date: yesterday,
        total_hours:  7.33,   // 7h 20m
        deep_hours:   2.17,   // 2h 10m
        light_hours:  4.0,
        rem_hours:    1.17,   // 1h 10m
      },
      { onConflict: "senior_id,session_date" },   // always overwrite
    );

  if (error) {
    console.warn("[HealthSimulator] sleep seed skipped:", error.message);
  } else {
    console.log("[HealthSimulator] ✓ sleep seed: last night 7.3h");
  }
}

/** Marks the night session complete — clears current_state, sets totals. */
async function completeNightSession(
  supabase: SupabaseClient,
  seniorId: string,
  sessionDate: string,
): Promise<void> {
  const { error } = await (supabase as any)
    .from("sleep_sessions")
    .update({
      total_hours:   7.0,
      deep_hours:    2.0,
      light_hours:   3.5,
      rem_hours:     1.5,
      current_state: null,   // clear on wake (requires schema cache refresh)
    })
    .eq("senior_id", seniorId)
    .eq("session_date", sessionDate);
  // Note: .is("ended_at", null) removed — ended_at not in PostgREST schema cache

  if (error) {
    console.warn("[HealthSimulator] sleep complete skipped:", error.message);
  } else {
    console.log("[HealthSimulator] ✓ sleep session completed");
  }
}

/**
 * Called on each 30s tick — drives current_state based on Beijing time:
 *   Night (23:00–06:00): awake 10% / deep 45% / light 45%
 *   Nap   (12:00–15:00): nap 40% chance (skip otherwise)
 *   Day   (other hours): resting 8% chance (skip otherwise)
 *
 * current_state writes require the PostgREST schema cache to be refreshed.
 * Reload at: Supabase Dashboard → Settings → API → Reload schema cache.
 */
async function tickSleepState(
  supabase: SupabaseClient,
  seniorId: string,
): Promise<void> {
  const { dateStr, hour } = getBjDate();
  const isNight = hour >= 23 || hour < 6;   // 23:00–05:59 BJ

  // ── Daytime ticks ─────────────────────────────────────────────
  if (!isNight) {
    if (nightSessionLive && nightSessionDate) {
      await completeNightSession(supabase, seniorId, nightSessionDate);
      nightSessionLive = false;
      nightSessionDate = "";
      sleepStateIdx    = 0;
    }

    // Nap window: 12:00–14:59 BJ
    if (hour >= 12 && hour < 15 && Math.random() < 0.40) {
      const { error } = await (supabase as any)
        .from("sleep_sessions")
        .update({ current_state: "nap" })
        .eq("senior_id", seniorId)
        .order("session_date", { ascending: false })
        .limit(1);
      if (error) {
        console.warn("[HealthSimulator] nap state skipped:", error.message);
      } else {
        console.log("[HealthSimulator] ✓ nap state written");
      }
    }

    // Occasional daytime resting (8% chance)
    if ((hour < 12 || hour >= 15) && Math.random() < 0.08) {
      const { error } = await (supabase as any)
        .from("sleep_sessions")
        .update({ current_state: "resting" })
        .eq("senior_id", seniorId)
        .order("session_date", { ascending: false })
        .limit(1);
      if (error) {
        console.warn("[HealthSimulator] resting state skipped:", error.message);
      } else {
        console.log("[HealthSimulator] ✓ resting state written");
      }
    }
    return;
  }

  // ── Night ticks ───────────────────────────────────────────────
  const anchorDate = hour >= 23 ? dateStr : getYesterdayBj();
  sleepStateIdx++;

  // Step 1: ensure session row exists (safe columns only)
  if (!nightSessionLive) {
    const { error } = await (supabase as any)
      .from("sleep_sessions")
      .upsert(
        { senior_id: seniorId, session_date: anchorDate },
        { onConflict: "senior_id,session_date" },
      );
    if (error) {
      console.warn("[HealthSimulator] sleep tick (start) skipped:", error.message);
      return;
    }
    nightSessionLive = true;
    nightSessionDate = anchorDate;
    console.log(`[HealthSimulator] ✓ night session created (date=${anchorDate})`);
  }

  // Step 2: update current_state (requires schema cache refresh)
  const rand = Math.random();
  const nightState: 'awake' | 'deep' | 'light' =
    rand < 0.10 ? 'awake' : rand < 0.55 ? 'deep' : 'light';

  const { error: stateErr } = await (supabase as any)
    .from("sleep_sessions")
    .update({ current_state: nightState })
    .eq("senior_id", seniorId)
    .eq("session_date", nightSessionDate);

  if (stateErr) {
    console.warn("[HealthSimulator] current_state update skipped:", stateErr.message);
  } else {
    console.log(`[HealthSimulator] ✓ night state: ${nightState}`);
  }
}

// ── Main simulator ────────────────────────────────────────────

export function startHealthSimulator(
  supabase: SupabaseClient,
  seniorId: string,
): () => void {
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

    const { error: hrErr } = await (supabase as any)
      .from("health_metrics")
      .insert({ senior_id: seniorId, metric_type: "heart_rate", value: heartRate, measured_at: now });

    if (hrErr) {
      console.warn("[HealthSimulator] heart_rate insert skipped:", hrErr.message);
    }

    const { error: stepsErr } = await (supabase as any)
      .from("health_metrics")
      .insert({ senior_id: seniorId, metric_type: "steps", value: cumulativeSteps, measured_at: now });

    if (stepsErr) {
      console.warn("[HealthSimulator] steps insert skipped:", stepsErr.message);
    }

    if (!hrErr && !stepsErr) {
      console.log(`[HealthSimulator] ✓ HR=${heartRate} bpm  steps=${cumulativeSteps}`);
    }

    await tickSleepState(supabase, seniorId);
  };

  seedLastNight(supabase, seniorId);

  tick();
  const id = setInterval(tick, INTERVAL_MS);
  return () => clearInterval(id);
}
