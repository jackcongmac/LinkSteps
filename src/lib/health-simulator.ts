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

function bjLocalToISO(dateStr: string, hh: number, mm: number): string {
  const [y, mo, dd] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, dd, hh - 8, mm)).toISOString();
}

// ── Sleep simulator ───────────────────────────────────────────

let sleepStateIdx    = 0;
let nightSessionLive = false;
let nightSessionDate = "";

/**
 * Seeds a completed "last night" row — only columns the schema cache knows about.
 * current_state / ended_at omitted until PostgREST cache is refreshed.
 */
async function seedLastNight(
  supabase: SupabaseClient,
  seniorId: string,
): Promise<void> {
  const yesterday          = getYesterdayBj();
  const { dateStr: today } = getBjDate();

  const startedAt = bjLocalToISO(yesterday, 22, 30);
  const endedAt   = bjLocalToISO(today,      6, 15);

  const { error } = await (supabase as any)
    .from("sleep_sessions")
    .upsert(
      {
        senior_id:    seniorId,
        session_date: yesterday,
        started_at:   startedAt,
        ended_at:     endedAt,       // timestamptz — safe if column exists
        total_hours:  6.5,
        deep_hours:   1.8,
        light_hours:  3.2,
        rem_hours:    1.5,
      },
      { onConflict: "senior_id,session_date", ignoreDuplicates: true },
    );

  if (error) {
    // Warn only — never console.error (prevents Next.js red overlay)
    console.warn("[HealthSimulator] sleep seed skipped:", error.message);
  } else {
    console.log("[HealthSimulator] ✓ sleep seed: last night 6.5h");
  }
}

/**
 * Completes an active session at 06:00 BJ.
 * Omits current_state until schema cache is refreshed.
 */
async function completeNightSession(
  supabase: SupabaseClient,
  seniorId: string,
  sessionDate: string,
): Promise<void> {
  const { error } = await (supabase as any)
    .from("sleep_sessions")
    .update({
      ended_at:    new Date().toISOString(),
      total_hours: 7.0,
      deep_hours:  2.0,
      light_hours: 3.5,
      rem_hours:   1.5,
    })
    .eq("senior_id", seniorId)
    .eq("session_date", sessionDate)
    .is("ended_at", null);

  if (error) {
    console.warn("[HealthSimulator] sleep complete skipped:", error.message);
  } else {
    console.log("[HealthSimulator] ✓ sleep session completed");
  }
}

/**
 * Called on each 30s tick — upserts minimal sleep row (no current_state).
 * Once schema cache is refreshed, re-add current_state here.
 */
async function tickSleepState(
  supabase: SupabaseClient,
  seniorId: string,
): Promise<void> {
  const { dateStr, hour } = getBjDate();
  const isNight = hour >= 22 || hour < 6;

  if (!isNight) {
    if (nightSessionLive && nightSessionDate) {
      await completeNightSession(supabase, seniorId, nightSessionDate);
    }
    nightSessionLive = false;
    nightSessionDate = "";
    sleepStateIdx    = 0;
    return;
  }

  const anchorDate = hour >= 22 ? dateStr : getYesterdayBj();
  sleepStateIdx++;

  if (!nightSessionLive) {
    const { error } = await (supabase as any)
      .from("sleep_sessions")
      .upsert(
        {
          senior_id:    seniorId,
          session_date: anchorDate,
          started_at:   new Date().toISOString(),
          // current_state omitted — schema cache doesn't see it yet
        },
        { onConflict: "senior_id,session_date" },
      );

    if (error) {
      console.warn("[HealthSimulator] sleep tick (start) skipped:", error.message);
    } else {
      nightSessionLive = true;
      nightSessionDate = anchorDate;
      console.log(`[HealthSimulator] ✓ sleep session started (date=${anchorDate})`);
    }
  }
  // Subsequent ticks: skip current_state update until schema cache is refreshed
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
