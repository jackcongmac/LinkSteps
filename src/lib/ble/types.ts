// ─────────────────────────────────────────────────────────────
// BLE + Dashboard types
//
// BleState:           the connection state machine states
// HardwareMetrics:    what the watch sends (or mock generates)
// EnvironmentData:    what the backend merges in (weather/pollen)
// SeniorDashboardPayload: the single composed object the UI renders
// ─────────────────────────────────────────────────────────────

export type BleState =
  | 'idle'        // not yet started
  | 'scanning'    // looking for the device
  | 'connecting'  // found, attempting GATT connect
  | 'connected'   // live session, data flowing
  | 'waiting';    // disconnected, backoff timer running

export interface SleepMetrics {
  total_hours:  number;
  deep_hours:   number;
}

export interface HardwareMetrics {
  steps:     number;
  sleep:     SleepMetrics;
  hrv:       number;       // ms — higher = better recovery
  timestamp: string;       // ISO 8601
}

export type PollenLevel = 'low' | 'medium' | 'high';

export interface EnvironmentData {
  pressure_hpa:  number;
  temp_c:        number;
  weather_text:  string;   // e.g. "晴", "多云"
  pollen_level?: PollenLevel; // Phase 2 — omitted until pollen API integrated
}

/** Single composed payload the Dashboard component renders */
export interface SeniorDashboardPayload {
  hardware:    HardwareMetrics;
  environment: EnvironmentData;
  synced_at:   string; // ISO 8601, set by the backend
}
