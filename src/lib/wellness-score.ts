// src/lib/wellness-score.ts
//
// calculateSeniorWellness — pure scoring function.
// No Supabase, no React. Accepts biometric + env inputs, returns a
// 0–100 score, a level, and a natural Chinese advice string.
//
// Rules (evaluated in priority order):
//   1. HeartRate > 120                           → Critical  (40)
//   2. Pressure < 1005 AND Sleep < 6h            → Alert     (60)
//   3. Steps > 3000 AND HeartRate < 90           → Great     (90)
//   4. Pressure < 1010 (mild low)                → Good      (70)
//   5. Sleep < 6h (alone)                        → Alert     (65)
//   6. Steps < 1500 (sedentary)                  → Good      (72)
//   7. Baseline — all clear                      → Great     (85)

export type WellnessLevel = 'great' | 'good' | 'alert' | 'critical';

export interface WellnessInput {
  pressure:  number;   // hPa — Beijing barometric pressure
  sleep:     number;   // total hours last night
  steps:     number;   // today's cumulative step count
  heartRate: number;   // latest bpm from health_metrics
}

export interface WellnessResult {
  score:  number;        // 0–100
  level:  WellnessLevel;
  advice: string;        // natural Chinese one-sentence advisory
}

export function calculateSeniorWellness(
  input: Partial<WellnessInput>,
): WellnessResult {
  const {
    pressure  = 1013,
    sleep     = 7,
    steps     = 0,
    heartRate = 75,
  } = input;

  // ── Rule 1: Heart rate anomaly (highest priority) ────────────
  if (heartRate > 120) {
    return {
      score:  40,
      level:  'critical',
      advice: `心率偏高（${heartRate} 次/分），建议立即联系老妈确认状况，避免剧烈活动。`,
    };
  }

  // ── Rule 2: Low pressure + poor sleep ────────────────────────
  if (pressure < 1005 && sleep < 6) {
    return {
      score:  60,
      level:  'alert',
      advice: `北京今日气压偏低（${pressure} hPa），老妈昨晚深睡不足（${sleep.toFixed(1)} 小时），建议减少户外，注意保暖休息。`,
    };
  }

  // ── Rule 3: Active + healthy heart rate ──────────────────────
  if (steps > 3000 && heartRate < 90) {
    return {
      score:  90,
      level:  'great',
      advice: `今日步数达 ${steps.toLocaleString()} 步，心率平稳（${heartRate} 次/分），老妈状态很棒！适合保持适度活动。`,
    };
  }

  // ── Rule 4: Mild low pressure ────────────────────────────────
  if (pressure < 1010) {
    return {
      score:  70,
      level:  'good',
      advice: `北京气压略偏低（${pressure} hPa），关节可能有些不适。今日步数 ${steps.toLocaleString()} 步，整体状况稳定。`,
    };
  }

  // ── Rule 5: Sleep deficit alone ──────────────────────────────
  if (sleep < 6) {
    return {
      score:  65,
      level:  'alert',
      advice: `老妈昨晚睡眠不足（${sleep.toFixed(1)} 小时），今日精力可能略有不足，建议提醒午间小憩。`,
    };
  }

  // ── Rule 6: Low activity ─────────────────────────────────────
  if (steps < 1500) {
    return {
      score:  72,
      level:  'good',
      advice: `今日活动量偏少（${steps.toLocaleString()} 步），天气好的话鼓励老妈出门散散步。`,
    };
  }

  // ── Rule 7: All clear ────────────────────────────────────────
  return {
    score:  85,
    level:  'great',
    advice: `各项指标平稳：步数 ${steps.toLocaleString()} 步，心率 ${heartRate} 次/分，北京气压正常。老妈今日状态良好。`,
  };
}
