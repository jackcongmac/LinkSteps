/**
 * BLE State Machine — framework-agnostic, no React dependencies.
 *
 * ┌────────┐  start()   ┌──────────┐  device found  ┌────────────┐  GATT ok  ┌───────────┐
 * │  idle  │──────────▶│ scanning │───────────────▶│ connecting │──────────▶│ connected │
 * └────────┘           └──────────┘                └────────────┘           └─────┬─────┘
 *                                                                                  │ disconnect
 *                            ◀── exponential backoff ──────────────────────────── ▼
 *                                                                            ┌─────────┐
 *                                                                            │ waiting │
 *                                                                            └─────────┘
 *
 * Web Bluetooth strategy (Android Chrome):
 *   1. getDevices()       — silent re-connect to previously granted devices
 *   2. requestDevice()    — first-time pairing (requires user gesture; call from setup flow)
 *
 * For Phase 1 testing, BLE is best-effort. If Web Bluetooth is
 * unavailable or the device is not found, state stays at 'waiting'
 * and the mock data loop still runs (controlled by the hook).
 *
 * Device filter: Xiaomi Watch uses namePrefix "Xiaomi Watch" or "Mi Watch".
 * Swap DEVICE_NAME_PREFIX to match whatever shows up in Android BT scan.
 */

import type { BleState, HardwareMetrics } from './types';
import { generateMockHardwareMetrics } from './mock-generator';

// ── Config ────────────────────────────────────────────────────

const DEVICE_NAME_PREFIX = 'Xiaomi Watch'; // adjust if device advertises differently

/** Interval between mock data pushes while connected (ms) */
const SYNC_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

/** Exponential backoff: base delay and ceiling (ms) */
const BACKOFF_BASE_MS  = 5_000;
const BACKOFF_MAX_MS   = 5 * 60_000; // 5 minutes max

// ── Types ─────────────────────────────────────────────────────

export type StateChangeCallback = (state: BleState) => void;
export type DataCallback        = (metrics: HardwareMetrics) => void;

// ── Class ─────────────────────────────────────────────────────

export class BleStateMachine {
  private state: BleState = 'idle';
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;

  private syncTimer:    ReturnType<typeof setInterval>  | null = null;
  private backoffTimer: ReturnType<typeof setTimeout>   | null = null;
  private backoffAttempt = 0;
  private destroyed = false;

  private onStateChange: StateChangeCallback;
  private onData:        DataCallback;

  constructor(onStateChange: StateChangeCallback, onData: DataCallback) {
    this.onStateChange = onStateChange;
    this.onData        = onData;
  }

  // ── Public API ──────────────────────────────────────────────

  getState(): BleState { return this.state; }

  /** Boot the machine. Safe to call multiple times. */
  async start(): Promise<void> {
    if (this.destroyed || this.state !== 'idle') return;
    await this.attemptConnect();
  }

  /** Tear down everything — call on component unmount */
  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
    this.disconnectGatt();
    this.setState('idle');
  }

  // ── Internal state helpers ──────────────────────────────────

  private setState(next: BleState): void {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange(next);
  }

  // ── Connection flow ─────────────────────────────────────────

  private async attemptConnect(): Promise<void> {
    if (this.destroyed) return;

    // Web Bluetooth availability check
    if (typeof navigator === 'undefined' || !('bluetooth' in navigator)) {
      // Browser doesn't support BLE — stay in waiting, run mock anyway
      this.setState('waiting');
      this.scheduleMockSync();
      return;
    }

    this.setState('scanning');

    try {
      const device = await this.findDevice();

      if (!device) {
        // No previously-granted device found; wait silently
        this.setState('waiting');
        this.scheduleBackoff();
        return;
      }

      this.device = device;
      this.device.addEventListener('gattserverdisconnected', this.handleDisconnect);

      this.setState('connecting');

      const server = await device.gatt!.connect();
      this.server = server;

      this.backoffAttempt = 0; // reset on successful connect
      this.setState('connected');
      this.scheduleMockSync();

    } catch {
      // Connection failed — silent backoff
      this.setState('waiting');
      this.scheduleBackoff();
    }
  }

  /**
   * Try getDevices() first (silent, no user gesture).
   * Returns the first matching device, or null.
   */
  private async findDevice(): Promise<BluetoothDevice | null> {
    try {
      // getDevices() returns devices the user previously granted access to
      const devices: BluetoothDevice[] = await (navigator.bluetooth as unknown as {
        getDevices(): Promise<BluetoothDevice[]>;
      }).getDevices();

      const match = devices.find(
        (d) => d.name?.startsWith(DEVICE_NAME_PREFIX),
      );
      if (match) return match;
    } catch {
      // getDevices() not yet supported on all browsers — fall through
    }

    // No cached device found; return null (do NOT call requestDevice here —
    // that requires a user gesture and would surprise the senior with a popup)
    return null;
  }

  // ── Disconnect / backoff ────────────────────────────────────

  private handleDisconnect = (): void => {
    if (this.destroyed) return;
    this.clearSyncTimer();
    this.setState('waiting');
    this.scheduleBackoff();
  };

  private scheduleBackoff(): void {
    if (this.destroyed) return;
    this.clearBackoffTimer();

    const delay = Math.min(
      BACKOFF_BASE_MS * 2 ** this.backoffAttempt,
      BACKOFF_MAX_MS,
    );
    this.backoffAttempt++;

    this.backoffTimer = setTimeout(() => {
      if (!this.destroyed) {
        this.setState('scanning');
        this.attemptConnect();
      }
    }, delay);
  }

  private disconnectGatt(): void {
    if (this.server?.connected) {
      try { this.server.disconnect(); } catch { /* ignore */ }
    }
    this.device?.removeEventListener('gattserverdisconnected', this.handleDisconnect);
    this.server = null;
    this.device = null;
  }

  // ── Mock data sync loop ─────────────────────────────────────

  /**
   * In Phase 1, we bypass actual GATT characteristic reads.
   * The mock generator fires every SYNC_INTERVAL_MS.
   * This also runs in 'waiting' state (BLE unavailable) so the
   * dashboard still gets data regardless of hardware availability.
   */
  private scheduleMockSync(): void {
    this.clearSyncTimer();
    // Fire immediately, then on interval
    this.pushMockData();
    this.syncTimer = setInterval(() => {
      if (!this.destroyed) this.pushMockData();
    }, SYNC_INTERVAL_MS);
  }

  private pushMockData(): void {
    const metrics = generateMockHardwareMetrics();
    this.onData(metrics);
  }

  // ── Timer cleanup ───────────────────────────────────────────

  private clearSyncTimer(): void {
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private clearBackoffTimer(): void {
    if (this.backoffTimer !== null) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearSyncTimer();
    this.clearBackoffTimer();
  }
}
