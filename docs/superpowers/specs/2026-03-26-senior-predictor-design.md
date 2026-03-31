# SeniorPredictor — Design Spec

**Date**: 2026-03-26
**Status**: Approved by Jack
**Scope**: Pure logic + UI mode toggle. No DB migration required.

---

## Problem

LinkSteps currently serves ASD/ADHD children. Jack wants to extend it to monitor elderly parents (70+) — specifically his father in Shanghai — using wearable biometrics and local weather to generate actionable care alerts.

## Approach

**Plan A (approved):** Hardcode a 7-day mock baseline in `senior-predictor.ts` for development. The predictor is a pure function accepting `(metrics, baseline)`. Future versions swap in real DB data without changing the predictor interface.

---

## Architecture

### New file: `src/lib/senior-predictor.ts`

Kept separate from `predictor.ts` (different domain: elderly cardiovascular vs. child sensory).

### Types

```ts
export interface SeniorMetrics {
  hrv?: number        // ms — today's reading
  steps?: number      // today's step count
  deepSleep?: number  // hours of deep sleep last night
  pressure?: number   // hPa — local barometric pressure
}

export interface SeniorBaseline {
  avgHRV: number      // 7-day average HRV (ms)
  avgSteps: number    // 7-day average daily steps
}

export type SeniorStatus = 'stable' | 'care' | 'critical'

export interface SeniorInsight {
  status: SeniorStatus
  headline: string    // short status summary
  message: string     // actionable notification text for the caregiver
  flags: string[]     // which factors triggered (for UI pills)
}
```

### Mock baseline (hardcoded for dev)

```ts
export const DAD_BASELINE: SeniorBaseline = {
  avgHRV:   48,    // ms — typical healthy elderly male
  avgSteps: 4500,  // steps/day
}
```

### Weighted scoring rules

| Factor | Weight | Threshold | Severity |
|--------|--------|-----------|----------|
| HRV | 50% | Deviation > 20% below baseline | Amber |
| HRV | 50% | Deviation > 35% below baseline | Rose |
| Steps | 20% | < 50% of baseline avg | Amber |
| Pressure | 15% | < 1010 hPa | Amber |
| Deep Sleep | 15% | < 1h | Rose |

### Output messages

- **Stable**: `"Dad is steady. Routine looks normal today."`
- **Care**: `"Dad seems fatigued (Low HRV). Suggest a quick video call tonight."`
- **Critical**: `"⚠️ Pressure dropping + Low activity. Joint pain risk high. Please call to check in."`

Message is selected by worst active flag. Custom message overrides when multiple flags combine.

---

## UI Changes (`src/app/log/page.tsx`)

### Mode toggle

```ts
type AppMode = 'CHILD' | 'SENIOR'
const [appMode, setAppMode] = useState<AppMode>('CHILD')
```

- Default: `'CHILD'` (no change to existing behaviour)
- When `'SENIOR'`:
  - Page `<h1>` → `"Parental Wellness Dashboard"`
  - Subtitle → `"Dad's wellness today"`
  - `OutlookCard` replaced by `SeniorOutlookCard` using `SeniorInsight`

### SeniorOutlookCard

Reuses `THREAT_STYLE` mapping:
- `stable` → `normal` (emerald green)
- `care` → `elevated` (amber)
- `critical` → `critical` (rose)

Mock data injected directly (no Supabase call needed for dev).

---

## What is NOT in scope

- Supabase `senior_metrics` table (Plan B — future)
- Real weather API for Shanghai
- Notification push / WeChat integration
- Multi-subject (only "Dad" hardcoded for now)
