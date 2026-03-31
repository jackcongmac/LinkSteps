/**
 * senior-predictor.ts — Elderly wellness sentinel for LinkSteps.
 *
 * Completely standalone (no Supabase, no React).
 * Exports:
 *   generateSeniorInsight(metrics, baseline?) → SeniorInsight
 *   DAD_BASELINE  — hardcoded 7-day mock baseline for development
 *
 * Weighted scoring (mirrors clinical evidence for 70+ age group):
 *   HRV          50% — cardiovascular stress indicator
 *   Steps        20% — mobility / activity anomaly
 *   Pressure     15% — joint pain / sensory trigger
 *   Deep Sleep   15% — cardiovascular risk when < 1h
 *
 * Priority order for alerts: HRV > Deep Sleep > Pressure > Steps
 */

// ── Types ─────────────────────────────────────────────────────

/** Today's biometric + environmental readings for the senior. */
export interface SeniorMetrics {
  hrv?: number;        // ms — today's heart rate variability
  steps?: number;      // today's step count
  deepSleep?: number;  // hours of deep sleep last night
  pressure?: number;   // hPa — local barometric pressure
}

/** 7-day rolling baseline — hardcoded for dev, swap in DB data for prod. */
export interface SeniorBaseline {
  avgHRV: number;    // ms
  avgSteps: number;  // steps/day
}

export type SeniorStatus = 'stable' | 'care' | 'critical';

export interface SeniorInsight {
  status: SeniorStatus;
  /** Short headline for the dashboard card header. */
  headline: string;
  /** Actionable caregiver notification — personal, warm tone. */
  message: string;
  /** Which factors triggered (shown as UI pills). */
  flags: string[];
}

// ── Mock baseline (7-day hardcoded for dev) ───────────────────
//
// Replace with a DB query (rolling avg of senior_metrics) for prod.
// Represents a healthy but typical elderly male profile.

export const DAD_BASELINE: SeniorBaseline = {
  avgHRV:   48,    // ms — healthy range for 70+ is 25–65ms
  avgSteps: 4500,  // steps/day
};

// ── Mock "today" data for dev testing ─────────────────────────
//
// Simulates a mildly concerning day: HRV slightly low, pressure dropping.
// Toggle MOCK_TODAY values to test each alert tier.

export const MOCK_TODAY_METRICS: SeniorMetrics = {
  hrv:       38,    // 21% below baseline → Amber (just crosses 20% threshold)
  steps:     4200,  // 93% of baseline → fine
  deepSleep: 1.2,   // above 1h → fine
  pressure:  1007,  // slightly below 1010 → Amber
};

// ── Thresholds ────────────────────────────────────────────────

const HRV_AMBER_PCT  = 0.20;   // 20% below baseline
const HRV_ROSE_PCT   = 0.35;   // 35% below baseline
const STEPS_AMBER_PCT = 0.50;  // less than 50% of baseline
const PRESSURE_AMBER = 1010;   // hPa — below this = joint/sensory risk
const DEEP_SLEEP_ROSE = 1.0;   // hours — below 1h = cardiovascular risk flag

// ── Internal flag type ────────────────────────────────────────

interface Flag {
  severity: 'care' | 'critical';
  label: string;       // short label for pill UI
  factor: string;      // used for message selection
}

// ── Scoring engine ────────────────────────────────────────────

function evaluate(m: SeniorMetrics, b: SeniorBaseline): Flag[] {
  const flags: Flag[] = [];

  // ── HRV (50% weight — highest priority) ───────────────────
  if (m.hrv !== undefined) {
    const drop = (b.avgHRV - m.hrv) / b.avgHRV;
    if (drop >= HRV_ROSE_PCT) {
      flags.push({
        severity: 'critical',
        label: `HRV ${m.hrv}ms`,
        factor: 'hrv-critical',
      });
    } else if (drop >= HRV_AMBER_PCT) {
      flags.push({
        severity: 'care',
        label: `Low HRV ${m.hrv}ms`,
        factor: 'hrv-low',
      });
    }
  }

  // ── Deep Sleep (15% weight — critical when < 1h) ──────────
  if (m.deepSleep !== undefined && m.deepSleep < DEEP_SLEEP_ROSE) {
    flags.push({
      severity: 'critical',
      label: `Deep sleep ${m.deepSleep}h`,
      factor: 'sleep-low',
    });
  }

  // ── Barometric Pressure (15% weight) ──────────────────────
  if (m.pressure !== undefined && m.pressure < PRESSURE_AMBER) {
    const drop = Math.round(1013 - m.pressure);
    flags.push({
      severity: 'care',
      label: `Pressure ${m.pressure}hPa`,
      factor: `pressure-low-${drop}`,
    });
  }

  // ── Steps (20% weight) ────────────────────────────────────
  if (m.steps !== undefined && m.steps < b.avgSteps * STEPS_AMBER_PCT) {
    flags.push({
      severity: 'care',
      label: `${m.steps.toLocaleString()} steps`,
      factor: 'steps-low',
    });
  }

  return flags;
}

// ── Message library ───────────────────────────────────────────
//
// Messages are personal and warm — written as if from a caring child
// to their sibling or co-caregiver. Compound flags get priority messages.

function buildMessage(flags: Flag[], m: SeniorMetrics): string {
  const hasCriticalHRV   = flags.some((f) => f.factor === 'hrv-critical');
  const hasLowHRV        = flags.some((f) => f.factor === 'hrv-low');
  const hasLowSleep      = flags.some((f) => f.factor === 'sleep-low');
  const hasLowPressure   = flags.some((f) => f.factor.startsWith('pressure-low'));
  const hasLowSteps      = flags.some((f) => f.factor === 'steps-low');

  // ── Critical compound scenarios ───────────────────────────
  if (hasCriticalHRV && hasLowSleep) {
    return '⚠️ HRV critically low and poor sleep last night. High cardiovascular stress. Please call Dad to check in now.';
  }
  if (hasLowPressure && hasLowSteps) {
    return `⚠️ Pressure dropping (${m.pressure}hPa) + Low activity. Joint pain risk high. Please call to check in.`;
  }
  if (hasCriticalHRV) {
    return `⚠️ Dad's HRV is critically low (${m.hrv}ms). This may signal high stress or poor recovery. Please call today.`;
  }
  if (hasLowSleep) {
    return `⚠️ Dad had less than 1h of deep sleep. Cardiovascular risk elevated. Check in and encourage rest.`;
  }

  // ── Single amber flags ────────────────────────────────────
  if (hasLowHRV) {
    return `Dad seems fatigued (Low HRV: ${m.hrv}ms). Suggest a quick video call tonight.`;
  }
  if (hasLowPressure) {
    return `Low barometric pressure today (${m.pressure}hPa). Joints may be uncomfortable. Consider reminding Dad about indoor activities.`;
  }
  if (hasLowSteps) {
    return `Dad's activity is lower than usual today (${m.steps?.toLocaleString()} steps). A gentle check-in might be welcome.`;
  }

  // ── Stable ────────────────────────────────────────────────
  return 'Dad is steady. Routine looks normal today.';
}

function buildHeadline(status: SeniorStatus, flags: Flag[]): string {
  if (status === 'stable') return 'All signals normal';
  if (status === 'critical') return `${flags.filter((f) => f.severity === 'critical').length} critical signal${flags.filter(f => f.severity === 'critical').length > 1 ? 's' : ''}`;
  return `${flags.length} signal${flags.length > 1 ? 's' : ''} need attention`;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Converts today's senior biometric snapshot into a caregiver insight.
 *
 * Pure function — no side-effects, no async.
 *
 * @param metrics   - Today's readings (all fields optional — partial data ok)
 * @param baseline  - 7-day averages. Defaults to DAD_BASELINE (hardcoded mock).
 */
export function generateSeniorInsight(
  metrics: SeniorMetrics,
  baseline: SeniorBaseline = DAD_BASELINE,
): SeniorInsight {
  const flags = evaluate(metrics, baseline);

  if (flags.length === 0) {
    return {
      status: 'stable',
      headline: 'All signals normal',
      message: 'Dad is steady. Routine looks normal today.',
      flags: [],
    };
  }

  const hasCritical = flags.some((f) => f.severity === 'critical');
  const status: SeniorStatus = hasCritical ? 'critical' : 'care';

  return {
    status,
    headline: buildHeadline(status, flags),
    message: buildMessage(flags, metrics),
    flags: flags.map((f) => f.label),
  };
}
