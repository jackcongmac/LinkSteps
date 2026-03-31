"use client";

/**
 * useBleConnection
 *
 * React wrapper around BleStateMachine.
 *
 * Responsibilities:
 *  1. Boot the state machine on mount, destroy on unmount
 *  2. Forward hardware metrics to POST /api/senior/health-sync
 *  3. Surface { bleState, dashboard, lastSyncedAt } to the component
 *
 * The hook never throws or shows error UI.
 * All failure states are communicated via `bleState = 'waiting'`.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { BleStateMachine } from '@/lib/ble/ble-state-machine';
import type { BleState, HardwareMetrics, SeniorDashboardPayload } from '@/lib/ble/types';

interface UseBleConnectionOptions {
  seniorId: string;
  /** City key passed to /api/weather for environment merging */
  city?: string;
}

interface UseBleConnectionResult {
  bleState:    BleState;
  dashboard:   SeniorDashboardPayload | null;
  lastSyncedAt: Date | null;
}

export function useBleConnection({
  seniorId,
  city = 'beijing',
}: UseBleConnectionOptions): UseBleConnectionResult {
  const [bleState,    setBleState]    = useState<BleState>('idle');
  const [dashboard,   setDashboard]   = useState<SeniorDashboardPayload | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Keep a stable ref so the machine callbacks don't close over stale state
  const machineRef = useRef<BleStateMachine | null>(null);

  const handleData = useCallback(async (metrics: HardwareMetrics) => {
    try {
      const res = await fetch('/api/senior/health-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seniorId, city, metrics }),
      });

      if (!res.ok) return; // silent fail

      const payload = (await res.json()) as SeniorDashboardPayload;
      setDashboard(payload);
      setLastSyncedAt(new Date(payload.synced_at));
    } catch {
      // Network error — silent, dashboard keeps showing last known state
    }
  }, [seniorId, city]);

  useEffect(() => {
    const machine = new BleStateMachine(setBleState, handleData);
    machineRef.current = machine;
    machine.start();

    return () => {
      machine.destroy();
      machineRef.current = null;
    };
  }, [handleData]);

  return { bleState, dashboard, lastSyncedAt };
}
