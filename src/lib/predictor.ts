/**
 * predictor.ts — Biometric & environmental sentinel.
 *
 * Completely standalone (no Supabase, no React).
 * Exports:
 *   generateDailyForecast(metadata, childName?) → ForecastResult
 *
 * All threshold constants are documented inline so a
 * paediatrician or parent can audit and adjust them.
 */

import type { LogMetadata } from '@/lib/mood-log';

// ── Output types ──────────────────────────────────────────────

export type ForecastSeverity = 'normal' | 'caution' | 'warning';

/** 3-tier threat system: normal < elevated < critical */
export type ThreatLevel = 'normal' | 'elevated' | 'critical';

/** One measurable factor with its danger bar progress (0–1). */
export interface FactorMetric {
  /** Short human label, e.g. "Sleep" */
  label: string;
  /** Emoji icon, e.g. "🌙" */
  icon: string;
  /** Raw display value, e.g. "5.5h" */
  value: string;
  /** 0 – 1 where 1 = most dangerous. Drives progress bar width. */
  danger: number;
  /** Tailwind colour for the progress bar fill */
  barColor: string;
}

export interface ForecastResult {
  severity: ForecastSeverity;
  threatLevel: ThreatLevel;
  headline: string;
  detail: string | null;
  /** Short chip labels, e.g. "High activity", "Low sleep" */
  factors: string[];
  /** Per-factor progress bar data */
  factorMetrics: FactorMetric[];
  /** Actionable suggestions keyed by factor keyword */
  prescriptions: string[];
  /**
   * Spectrum-informed slogan selected from a curated ASD-safe library.
   * Undefined when there are no elevated signals (normal day).
   */
  slogan?: string;
}

// ── Spectrum-informed slogan library ──────────────────────────
//
// All slogans are reviewed for ASD/ADHD appropriateness.
// They describe evidence-based principles, not situational instructions.
// Triggers are checked in order — first match wins.

interface SloganEntry {
  /** Factor keywords that activate this slogan (substring match, lowercase). */
  triggers: string[];
  /** Slogan text. Use {name} as a placeholder for the child's name. */
  text: string;
}

const SPECTRUM_SLOGANS: SloganEntry[] = [
  // Activity signals → transition support
  {
    triggers: ['activity'],
    text: 'Structured routines help {name} manage transitions.',
  },
  // Sleep signals → predictability
  {
    triggers: ['sleep'],
    text: 'Predictability reduces anxiety during environmental changes.',
  },
  // Environmental signals (pollen, pressure, temperature)
  {
    triggers: ['pollen', 'pressure', 'temperature'],
    text: "Clear visual cues can support {name}'s daily flow today.",
  },
  // Stress / HRV signals → regulation
  {
    triggers: ['stress', 'hrv'],
    text: 'Familiar environments and low-stimulation spaces support nervous system regulation.',
  },
];

/** Fallback shown when hits exist but no trigger matches. */
const SLOGAN_FALLBACK = 'Structured routines and predictability support {name} best.';

/**
 * Selects the most relevant spectrum-informed slogan for the current signals.
 * Returns undefined when there are no elevated signals.
 */
function selectSlogan(hits: RuleHit[], name: string): string | undefined {
  if (hits.length === 0) return undefined;
  for (const entry of SPECTRUM_SLOGANS) {
    const matched = entry.triggers.some((t) =>
      hits.some((h) => h.factor.toLowerCase().includes(t)),
    );
    if (matched) return entry.text.replace(/\{name\}/g, name);
  }
  return SLOGAN_FALLBACK.replace(/\{name\}/g, name);
}

// ── Thresholds ────────────────────────────────────────────────

const T = {
  steps: { high: 12_000, veryHigh: 15_000 },
  sleep: { low: 6.5,    veryLow: 5 },
  hrv:   { low: 20,     veryLow: 15 },       // ms — higher = better
  pollen:{ high: 7,     veryHigh: 9 },        // EPA 0–10 scale
  tempF: { hot: 95,     cold: 40 },           // °F
} as const;

// ── Internal rule type ────────────────────────────────────────

interface RuleHit {
  severity: ForecastSeverity;
  factor: string;
  detail: string;
  prescription: string;
  metric: FactorMetric;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function evaluate(m: LogMetadata): RuleHit[] {
  const hits: RuleHit[] = [];

  // Steps
  if (m.steps !== undefined) {
    if (m.steps >= T.steps.veryHigh) {
      const danger = clamp((m.steps - T.steps.high) / (T.steps.veryHigh - T.steps.high), 0.5, 1);
      const pctAbove = Math.round(((m.steps - T.steps.high) / T.steps.high) * 100);
      hits.push({
        severity: 'warning',
        factor: 'Very high activity',
        detail: `${m.steps.toLocaleString()} steps — ${pctAbove}% above high-activity threshold (${T.steps.high.toLocaleString()}).`,
        prescription: `Activity: ${m.steps.toLocaleString()} steps (threshold: ${T.steps.veryHigh.toLocaleString()})`,
        metric: { label: 'Activity', icon: '👟', value: `${m.steps.toLocaleString()} steps`, danger, barColor: 'bg-rose-400' },
      });
    } else if (m.steps >= T.steps.high) {
      const danger = clamp((m.steps - 8_000) / (T.steps.high - 8_000), 0.3, 0.65);
      const pctAbove = Math.round(((m.steps - 8_000) / 8_000) * 100);
      hits.push({
        severity: 'caution',
        factor: 'High activity',
        detail: `${m.steps.toLocaleString()} steps — ${pctAbove}% above typical baseline (8,000).`,
        prescription: `Activity: ${m.steps.toLocaleString()} steps (caution threshold: ${T.steps.high.toLocaleString()})`,
        metric: { label: 'Activity', icon: '👟', value: `${m.steps.toLocaleString()} steps`, danger, barColor: 'bg-amber-400' },
      });
    }
  }

  // Sleep
  if (m.sleep_hours !== undefined) {
    if (m.sleep_hours <= T.sleep.veryLow) {
      const danger = clamp(1 - m.sleep_hours / T.sleep.veryLow, 0.7, 1);
      const pctBelow = Math.round(((7 - m.sleep_hours) / 7) * 100);
      hits.push({
        severity: 'warning',
        factor: 'Very low sleep',
        detail: `${m.sleep_hours}h sleep — ${pctBelow}% below 7h baseline.`,
        prescription: `Sleep: ${m.sleep_hours}h (critical threshold: ${T.sleep.veryLow}h)`,
        metric: { label: 'Sleep', icon: '🌙', value: `${m.sleep_hours}h`, danger, barColor: 'bg-rose-400' },
      });
    } else if (m.sleep_hours < T.sleep.low) {
      const danger = clamp(1 - m.sleep_hours / T.sleep.low, 0.3, 0.7);
      const pctBelow = Math.round(((7 - m.sleep_hours) / 7) * 100);
      hits.push({
        severity: 'caution',
        factor: 'Low sleep',
        detail: `${m.sleep_hours}h sleep — ${pctBelow}% below 7h baseline.`,
        prescription: `Sleep: ${m.sleep_hours}h (caution threshold: ${T.sleep.low}h)`,
        metric: { label: 'Sleep', icon: '🌙', value: `${m.sleep_hours}h`, danger, barColor: 'bg-amber-400' },
      });
    }
  }

  // HRV
  if (m.heart_rate_variability !== undefined) {
    if (m.heart_rate_variability <= T.hrv.veryLow) {
      const danger = clamp(1 - m.heart_rate_variability / T.hrv.low, 0.7, 1);
      hits.push({
        severity: 'warning',
        factor: 'Elevated stress (HRV)',
        detail: `HRV ${m.heart_rate_variability}ms — ${Math.round((1 - m.heart_rate_variability / T.hrv.low) * 100)}% below low baseline (${T.hrv.low}ms).`,
        prescription: `HRV: ${m.heart_rate_variability}ms (critical threshold: ${T.hrv.veryLow}ms)`,
        metric: { label: 'Stress (HRV)', icon: '💓', value: `${m.heart_rate_variability}ms`, danger, barColor: 'bg-rose-400' },
      });
    } else if (m.heart_rate_variability <= T.hrv.low) {
      const danger = clamp(1 - m.heart_rate_variability / T.hrv.low, 0.3, 0.7);
      hits.push({
        severity: 'caution',
        factor: 'Mild stress (HRV)',
        detail: `HRV ${m.heart_rate_variability}ms — below ${T.hrv.low}ms caution threshold.`,
        prescription: `HRV: ${m.heart_rate_variability}ms (caution threshold: ${T.hrv.low}ms)`,
        metric: { label: 'Stress (HRV)', icon: '💓', value: `${m.heart_rate_variability}ms`, danger, barColor: 'bg-amber-400' },
      });
    }
  }

  // Pollen
  if (m.pollen_level !== undefined) {
    if (m.pollen_level >= T.pollen.veryHigh) {
      const danger = clamp(m.pollen_level / 10, 0.8, 1);
      hits.push({
        severity: 'warning',
        factor: 'Extreme pollen',
        detail: `Pollen index ${m.pollen_level}/10 (EPA scale) — above very-high threshold (${T.pollen.veryHigh}).`,
        prescription: `Pollen: ${m.pollen_level}/10 (critical threshold: ${T.pollen.veryHigh})`,
        metric: { label: 'Pollen', icon: '🤧', value: `${m.pollen_level}/10`, danger, barColor: 'bg-rose-400' },
      });
    } else if (m.pollen_level >= T.pollen.high) {
      const danger = clamp(m.pollen_level / 10, 0.5, 0.8);
      hits.push({
        severity: 'caution',
        factor: 'High pollen',
        detail: `Pollen index ${m.pollen_level}/10 — above high threshold (${T.pollen.high}).`,
        prescription: `Pollen: ${m.pollen_level}/10 (caution threshold: ${T.pollen.high})`,
        metric: { label: 'Pollen', icon: '🤧', value: `${m.pollen_level}/10`, danger, barColor: 'bg-amber-400' },
      });
    }
  }

  // Barometric pressure (hPa) — standard ~1013
  if (m.pressure !== undefined) {
    if (m.pressure < 990) {
      const danger = clamp((1013 - m.pressure) / 30, 0.6, 1);
      const drop = Math.round(1013 - m.pressure);
      hits.push({
        severity: 'warning',
        factor: 'Low atmospheric pressure',
        detail: `${m.pressure}hPa — ${drop}hPa below standard (1013hPa).`,
        prescription: `Pressure: ${m.pressure}hPa (critical threshold: 990hPa)`,
        metric: { label: 'Pressure', icon: '🌬️', value: `${m.pressure}hPa`, danger, barColor: 'bg-violet-400' },
      });
    } else if (m.pressure < 1003) {
      const danger = clamp((1013 - m.pressure) / 30, 0.25, 0.55);
      const drop = Math.round(1013 - m.pressure);
      hits.push({
        severity: 'caution',
        factor: 'Slightly low pressure',
        detail: `${m.pressure}hPa — ${drop}hPa below standard (1013hPa).`,
        prescription: `Pressure: ${m.pressure}hPa (caution threshold: 1003hPa)`,
        metric: { label: 'Pressure', icon: '🌬️', value: `${m.pressure}hPa`, danger, barColor: 'bg-slate-400' },
      });
    }
  }

  // Temperature
  if (m.temperature !== undefined) {
    if (m.temperature >= T.tempF.hot) {
      const danger = clamp((m.temperature - T.tempF.hot) / 15, 0.4, 1);
      hits.push({
        severity: 'caution',
        factor: 'Extreme heat',
        detail: `${m.temperature}°F — ${Math.round(m.temperature - T.tempF.hot)}°F above high threshold (${T.tempF.hot}°F).`,
        prescription: `Temperature: ${m.temperature}°F (threshold: ${T.tempF.hot}°F)`,
        metric: { label: 'Temperature', icon: '🌡️', value: `${m.temperature}°F`, danger, barColor: 'bg-amber-400' },
      });
    } else if (m.temperature <= T.tempF.cold) {
      const danger = clamp((T.tempF.cold - m.temperature) / 20, 0.3, 0.8);
      hits.push({
        severity: 'caution',
        factor: 'Cold weather',
        detail: `${m.temperature}°F — ${Math.round(T.tempF.cold - m.temperature)}°F below cold threshold (${T.tempF.cold}°F).`,
        prescription: `Temperature: ${m.temperature}°F (threshold: ${T.tempF.cold}°F)`,
        metric: { label: 'Temperature', icon: '🌡️', value: `${m.temperature}°F`, danger, barColor: 'bg-sky-400' },
      });
    }
  }

  return hits;
}

// ── Threat level ──────────────────────────────────────────────

function computeThreatLevel(hits: RuleHit[]): ThreatLevel {
  const warningCount = hits.filter((h) => h.severity === 'warning').length;
  if (warningCount >= 2 || hits.length >= 3) return 'critical';
  if (hits.some((h) => h.severity === 'warning') || hits.length >= 2) return 'elevated';
  return 'normal';
}

// ── Public API ────────────────────────────────────────────────

/**
 * Converts a snapshot of biometric / environmental data into
 * a human-readable day forecast.
 *
 * Pure function — no side-effects, no async.
 *
 * @param childName - Optional child name for personalised headlines (demo / real).
 */
export function generateDailyForecast(
  metadata: LogMetadata,
  childName?: string,
): ForecastResult {
  const hits = evaluate(metadata);
  const name = childName ?? 'your child';

  if (hits.length === 0) {
    return {
      severity: 'normal',
      threatLevel: 'normal',
      headline: 'No elevated signals today.',
      detail: 'All measured indicators within normal range.',
      factors: [],
      factorMetrics: [],
      prescriptions: [],
    };
  }

  const threatLevel = computeThreatLevel(hits);
  const severity: ForecastSeverity = hits.some((h) => h.severity === 'warning')
    ? 'warning'
    : 'caution';

  const factors      = hits.map((h) => h.factor);
  const factorMetrics = hits.map((h) => h.metric);
  const prescriptions = hits.map((h) => h.prescription);

  // Build a concise factual headline from the leading signals
  const hasHighActivity = hits.some((h) => h.factor.toLowerCase().includes('activity'));
  const hasLowSleep     = hits.some((h) => h.factor.toLowerCase().includes('sleep'));
  const hasStress       = hits.some((h) => h.factor.toLowerCase().includes('stress') || h.factor.toLowerCase().includes('hrv'));
  const hasPollen       = hits.some((h) => h.factor.toLowerCase().includes('pollen'));

  // Build signal list for headline (e.g. "high activity + low sleep + pollen")
  const signalParts: string[] = [];
  if (hasHighActivity) signalParts.push(`${metadata.steps?.toLocaleString() ?? '—'} steps`);
  if (hasLowSleep)     signalParts.push(`${metadata.sleep_hours ?? '—'}h sleep`);
  if (hasStress)       signalParts.push(`HRV ${metadata.heart_rate_variability ?? '—'}ms`);
  if (hasPollen)       signalParts.push(`pollen ${metadata.pollen_level ?? '—'}/10`);
  // Add any remaining signals not covered above
  hits.forEach((h) => {
    if (!hasHighActivity && !hasLowSleep && !hasStress && !hasPollen) {
      signalParts.push(h.factor.toLowerCase());
    }
  });

  const signalSummary = signalParts.join(' · ');
  const flagCount = hits.length;

  let headline: string;

  if (threatLevel === 'critical') {
    headline = `${flagCount} elevated signals today${signalSummary ? `: ${signalSummary}` : ''}.`;
  } else if (signalParts.length >= 2) {
    headline = `${signalSummary}.`;
  } else {
    headline = hits[0].detail;
  }

  const detail =
    hits.length > 1 ? hits.slice(1).map((h) => h.detail).join(' ') : null;

  const slogan = selectSlogan(hits, name);

  return { severity, threatLevel, headline, detail, factors, factorMetrics, prescriptions, slogan };
}
