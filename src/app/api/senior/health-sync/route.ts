/**
 * POST /api/senior/health-sync
 *
 * Receives hardware metrics from the BLE hook, merges with
 * live environmental data (QWeather), persists to health_snapshots,
 * and returns a single composed SeniorDashboardPayload.
 *
 * Body:
 *   { seniorId: string; city?: string; metrics: HardwareMetrics }
 *
 * Response: SeniorDashboardPayload
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { HardwareMetrics, SeniorDashboardPayload, EnvironmentData } from '@/lib/ble/types';
import type { WeatherPayload } from '@/app/api/weather/route';

// ── Auth helper ───────────────────────────────────────────────

async function getUser(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return { user, supabase };
}

// ── Weather fetch (reuses the existing /api/weather proxy) ────

async function fetchEnvironment(
  city: string,
  baseUrl: string,
): Promise<EnvironmentData> {
  try {
    const res = await fetch(`${baseUrl}/api/weather?city=${city}`, {
      next: { revalidate: 900 }, // 15-min cache — same as the weather route
    });

    if (res.ok) {
      const w = (await res.json()) as WeatherPayload;
      return {
        pressure_hpa: w.pressure,
        temp_c:       Math.round(w.temp_c),
        weather_text: w.text,
        // pollen_level: Phase 2 — omit for now
      };
    }
  } catch { /* fall through to default */ }

  // Graceful degradation — return Beijing spring defaults
  return { pressure_hpa: 1012, temp_c: 14, weather_text: '多云' };
}

// ── Upsert health snapshot ────────────────────────────────────

async function upsertSnapshot(
  supabase: ReturnType<typeof createServerClient>,
  seniorId: string,
  metrics: HardwareMetrics,
  env: EnvironmentData,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  await supabase.from('health_snapshots').upsert(
    {
      senior_id:            seniorId,
      snapshot_date:        today,
      steps:                metrics.steps,
      weather_pressure_hpa: env.pressure_hpa,
      weather_temp_c:       env.temp_c,
      weather_text:         env.weather_text,
      sleep_duration_hours: metrics.sleep.total_hours,
      deep_sleep_hours:     metrics.sleep.deep_hours,
      hrv_ms:               metrics.hrv,
    },
    { onConflict: 'senior_id,snapshot_date' },
  );
}

// ── Handler ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { user, supabase } = await getUser(req);
  if (!user) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    seniorId: string;
    city?: string;
    metrics: HardwareMetrics;
  } | null;

  if (!body?.seniorId || !body?.metrics) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
  }

  const city = body.city ?? 'beijing';

  // Base URL for internal fetch (needed on server side)
  const baseUrl = req.nextUrl.origin;

  // Fetch environment in parallel with nothing else for now
  const environment = await fetchEnvironment(city, baseUrl);

  // Persist to DB (non-blocking — we don't await errors for UX speed)
  upsertSnapshot(supabase, body.seniorId, body.metrics, environment).catch(
    (e) => console.error('[health-sync] upsert failed:', e),
  );

  const payload: SeniorDashboardPayload = {
    hardware:    body.metrics,
    environment,
    synced_at:   new Date().toISOString(),
  };

  return NextResponse.json(payload);
}
