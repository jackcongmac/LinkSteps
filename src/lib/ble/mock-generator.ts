/**
 * Mock hardware metrics generator.
 *
 * Produces realistic Xiaomi Watch-like values for Beijing spring.
 * Seeded with slight hour-of-day drift so successive calls feel
 * like a real watch reporting incremental data.
 *
 * Ranges calibrated to DAD_BASELINE in senior-predictor.ts:
 *   steps baseline   ≈ 4 500
 *   HRV baseline     ≈ 48 ms
 *   sleep baseline   ≈ 6.5 h total, 1.4 h deep
 */

import type { HardwareMetrics } from './types';

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/** ±variance random offset, rounded to `decimals` places */
function jitter(base: number, variance: number, decimals = 0): number {
  const raw = base + (Math.random() * 2 - 1) * variance;
  const factor = 10 ** decimals;
  return Math.round(raw * factor) / factor;
}

export function generateMockHardwareMetrics(): HardwareMetrics {
  const now = new Date();
  const hourOfDay = now.getHours();

  // Steps accumulate through the day — peak at ~18:00
  const stepProgress = clamp(hourOfDay / 18, 0, 1);
  const steps = clamp(
    Math.round(jitter(4500 * stepProgress, 600)),
    0,
    12000,
  );

  // Sleep is reported in the morning; default to 0 if asked mid-day
  const isMorning = hourOfDay < 10;
  const totalSleep = isMorning
    ? clamp(jitter(6.4, 0.8, 1), 4.0, 9.0)
    : clamp(jitter(6.4, 0.4, 1), 4.0, 9.0); // stale reading persists

  const deepRatio = clamp(jitter(0.22, 0.05, 2), 0.10, 0.35);
  const deepSleep = clamp(
    Math.round(totalSleep * deepRatio * 10) / 10,
    0.5,
    3.0,
  );

  // HRV — lower in the afternoon due to activity/stress
  const hrvDrift = hourOfDay > 14 ? -4 : 0;
  const hrv = clamp(Math.round(jitter(46 + hrvDrift, 8)), 28, 72);

  return {
    steps,
    sleep: {
      total_hours: totalSleep,
      deep_hours:  deepSleep,
    },
    hrv,
    timestamp: now.toISOString(),
  };
}
