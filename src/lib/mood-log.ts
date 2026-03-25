/**
 * mood-log.ts — Mood check-in write and read helpers.
 *
 * Exports:
 *   saveMoodLog      – write today's mood (+ optional note) to log_entries
 *   getWeeklyLogs    – read the last 7 days of mood levels for one child
 *   getTodayLogs     – check which children already have a mood entry today
 *   getDailyProgress – aggregate count: how many children are logged today
 */
import { createClient } from '@/lib/supabase';
import type { MoodLevel, MoodIconName } from '@/components/ui/mood-picker';

// ── Shared types ─────────────────────────────────────────────

/** One day in the 7-day trend view. `level` is null when no mood was logged. */
export interface DayMood {
  date: string;                    // YYYY-MM-DD
  level: 1 | 2 | 3 | 4 | 5 | null;
}

/** One row from the `logs` table, used by the Recent Logs list. */
export interface LogEntry {
  id: string;
  mood: string;          // 'Very Low' | 'Not Great' | 'Okay' | 'Good' | 'Great'
  note: string | null;
  created_at: string;    // ISO 8601 timestamp
  /** Author's display name from profiles.display_name — null if profile not yet created. */
  author_name?: string | null;
  /** Author's role from profiles.role */
  author_role?: 'parent' | 'teacher' | 'therapist' | null;
}

/** All mood labels ordered best → worst. */
export const MOOD_DISPLAY_ORDER = [
  'Great', 'Good', 'Okay', 'Not Great', 'Very Low',
] as const;

export type MoodLabel = typeof MOOD_DISPLAY_ORDER[number];

/** Per-mood aggregate for the 7-day stats card. */
export interface MoodStat {
  mood: MoodLabel;
  count: number;
  pct: number;   // 0–100, rounded integer
}

/** Full weekly stats payload for the Insights page. */
export interface WeeklyStats {
  total: number;
  stats: MoodStat[];   // length 5, Great first; count/pct may be 0
  byDate: Array<{ date: string; mood: MoodLabel | null }>;  // 7 entries, oldest → newest
  weekStart: string;   // local YYYY-MM-DD
  weekEnd: string;     // local YYYY-MM-DD (today)
}

// ── Date helpers ─────────────────────────────────────────────

/**
 * Returns the LOCAL calendar date in YYYY-MM-DD format.
 *
 * ⚠️  Do NOT use `new Date().toISOString().split('T')[0]` — that gives the
 * UTC date, which is already the next calendar day for West-Coast users at
 * 11 PM (PDT = UTC-7, PST = UTC-8). Using `.getFullYear()` / `.getMonth()` /
 * `.getDate()` reads the device's local clock, which is what the user expects.
 */
function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local date `n` days before today. */
function localISODateDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n); // setDate operates in local time
  return localISODate(d);
}

/** Ascending array of the last 7 local dates, oldest first. */
function last7LocalDates(): string[] {
  return Array.from({ length: 7 }, (_, i) => localISODateDaysAgo(6 - i));
}

// ── Internal maps ─────────────────────────────────────────────

/** Lucide PascalCase → DB icon_name (lowercase kebab-case) */
const iconNameMap: Record<MoodIconName, 'sun' | 'smile' | 'cloud' | 'cloud-rain' | 'zap'> = {
  Sun: 'sun',
  Smile: 'smile',
  Cloud: 'cloud',
  CloudRain: 'cloud-rain',
  Zap: 'zap',
};

const levelLabelMap: Record<MoodLevel, string> = {
  1: 'Very Low',
  2: 'Not Great',
  3: 'Okay',
  4: 'Good',
  5: 'Great',
};

// ── LogMetadata ───────────────────────────────────────────────

/**
 * Optional biometric + environmental snapshot stored in the
 * `metadata` JSONB column of the `logs` table.
 *
 * Divided into two logical groups:
 *   • Environmental fields  — set by parents / teachers (biometric sensors, weather)
 *   • Behavioral fields     — set by therapists (ABA session data)
 *
 * All fields are optional — partial data is fine.
 */
export interface LogMetadata {
  // ── Environmental (parent / teacher) ──────────────────────
  steps?: number;                  // daily step count
  heart_rate_variability?: number; // ms — higher = better recovery
  sleep_hours?: number;            // previous night's sleep
  pollen_level?: number;           // 0–10 EPA scale
  temperature?: number;            // °F
  pressure?: number;               // barometric pressure in hPa (standard ~1013)

  // ── Behavioral (therapist / ABA) ──────────────────────────
  /** ABA behaviour labels, e.g. ["hitting", "elopement", "self-stimming"] */
  behavior_tag?: string[];
  /** Duration of the observed behaviour episode in seconds */
  behavior_duration_sec?: number;
  /** Clinician-rated intensity 1 (minimal) – 5 (severe) */
  behavior_intensity?: 1 | 2 | 3 | 4 | 5;
}

// ── Schema-migration guard ────────────────────────────────────
//
// PostgREST uses TWO different error codes for missing columns:
//   42703  – PostgreSQL "undefined_column" (SELECT/query level)
//   PGRST204 – PostgREST schema-cache miss on INSERT/PATCH
//
// Both mean "column doesn't exist yet — migration hasn't run."
// Check for either so the fallback path fires in both cases.

function isMissingColumnError(err: { code?: string } | null | undefined): boolean {
  return err?.code === '42703' || err?.code === 'PGRST204';
}

// ── UserProfile (Settings) ────────────────────────────────────

/**
 * The user's identity as stored in the `profiles` table and mirrored in
 * localStorage for instant availability before migration runs.
 */
export interface UserProfile {
  display_name: string;
  role: 'parent' | 'teacher' | 'therapist';
  /** Primary child's name — used to personalise OutlookCard headlines. */
  child_name: string;
  /** Child's date of birth in YYYY-MM-DD (local). Drives age-aware AI hints. */
  child_birthday?: string;
}

const PROFILE_STORAGE_KEY = 'linksteps_profile';

/** Read from localStorage (client-only). Returns null if unavailable. */
function readLocalProfile(): UserProfile | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

/** Write to localStorage and notify same-tab listeners (client-only). */
function writeLocalProfile(profile: UserProfile): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    // Notify components (e.g. log page) that the profile changed
    window.dispatchEvent(new Event('linksteps:profile_updated'));
  } catch { /* ignore */ }
}

/**
 * Returns the current user's profile.
 * Priority: DB profiles table → localStorage → auth metadata → empty defaults.
 */
export async function getProfile(): Promise<UserProfile> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { data } = await supabase
        .from('profiles')
        .select('display_name, role, child_name, child_birthday')
        .eq('id', user.id)
        .single();

      if (data) {
        const p = data as { display_name: string; role: string; child_name: string | null; child_birthday: string | null };
        const profile: UserProfile = {
          display_name: p.display_name ?? '',
          role: (['parent', 'teacher', 'therapist'] as const).includes(p.role as UserProfile['role'])
            ? (p.role as UserProfile['role'])
            : 'parent',
          child_name:     p.child_name     ?? '',
          child_birthday: p.child_birthday ?? undefined,
        };
        writeLocalProfile(profile); // keep localStorage in sync
        return profile;
      }

      // Profiles table missing or no row — try localStorage
      const local = readLocalProfile();
      if (local) return local;

      // Last resort: derive from auth metadata
      const meta = user.user_metadata as Record<string, string> | null;
      return {
        display_name: meta?.full_name ?? meta?.name ?? (user.email?.split('@')[0] ?? ''),
        role: 'parent',
        child_name: '',
      };
    }
  } catch { /* fall through */ }

  return { display_name: '', role: 'parent', child_name: '' };
}

/**
 * Saves the user's profile.
 * Always writes to localStorage immediately; attempts DB upsert as well.
 * Gracefully ignores missing-table errors.
 */
export async function upsertProfile(profile: UserProfile): Promise<{ error?: string }> {
  writeLocalProfile(profile);

  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: 'Not signed in.' };

    const { error } = await supabase
      .from('profiles')
      .upsert({
        id:             user.id,
        display_name:   profile.display_name,
        role:           profile.role,
        child_name:     profile.child_name,
        child_birthday: profile.child_birthday ?? null,
        updated_at:     new Date().toISOString(),
      });

    if (error) {
      if (isMissingColumnError(error)) {
        // child_birthday or child_name column missing — retry with only base columns
        const { error: e2 } = await supabase
          .from('profiles')
          .upsert({
            id:           user.id,
            display_name: profile.display_name,
            role:         profile.role,
            updated_at:   new Date().toISOString(),
          });
        // 42P01 / PGRST205 = table doesn't exist yet — localStorage already saved it
        if (e2 && e2.code !== 'PGRST205' && e2.code !== '42P01') {
          return { error: e2.message };
        }
      } else if (error.code !== 'PGRST205' && error.code !== '42P01') {
        return { error: error.message };
      }
    }
  } catch {
    // Network error — localStorage already saved it, so not fatal
  }

  return {};
}

// ── saveLog (logs table) ──────────────────────────────────────

type SaveLogResult = { id: string } | { error: string };

/**
 * Writes one row to the `logs` table.
 *   • mood is stored as the human-readable label ('Very Low' … 'Great')
 *   • note and metadata are optional
 */
export async function saveLog({
  level,
  note,
  metadata,
}: {
  level: MoodLevel;
  note?: string;
  metadata?: LogMetadata;
}): Promise<SaveLogResult> {
  try {
    const supabase = createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { error: 'Not signed in. Please log in and try again.' };
    }

    // Fetch the author's profile to stamp name + role on the log row.
    // Non-blocking: if the profile doesn't exist yet, fall back to nulls.
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, role')
      .eq('id', user.id)
      .single();

    const authorName = profile ? (profile as { display_name: string; role: string }).display_name : null;
    const rawRole    = profile ? (profile as { display_name: string; role: string }).role : null;
    const authorRole = (rawRole === 'parent' || rawRole === 'teacher' || rawRole === 'therapist')
      ? rawRole
      : null;

    // Attempt full insert (post-migration schema: metadata, author_name, author_role).
    // If the migration hasn't run yet, Postgres returns code 42703 "undefined_column".
    // In that case, fall back to the baseline schema so saves keep working.
    let result = await supabase
      .from('logs')
      .insert({
        user_id:     user.id,
        mood:        levelLabelMap[level],
        note:        note ?? null,
        metadata:    metadata ?? null,
        author_name: authorName,
        author_role: authorRole,
      })
      .select('id')
      .single();

    if (isMissingColumnError(result.error)) {
      // Pre-migration fallback — only columns guaranteed to exist
      result = await supabase
        .from('logs')
        .insert({
          user_id: user.id,
          mood:    levelLabelMap[level],
          note:    note ?? null,
        })
        .select('id')
        .single();
    }

    const { data, error } = result;
    if (error || !data) {
      return { error: error?.message ?? 'Failed to save log.' };
    }

    return { id: (data as { id: string }).id };
  } catch {
    return { error: 'Network error. Please check your connection and try again.' };
  }
}

// ── saveMoodLog ───────────────────────────────────────────────

type SaveMoodLogResult = { entryId: string } | { error: string };

/**
 * Steps:
 *   1. Resolve the current authenticated user
 *   2. Upsert daily_logs (ensure today's local-date log container exists)
 *   3. Insert a mood log_entry
 *   4. Insert a note log_entry if the user added one
 */
export async function saveMoodLog({
  childId,
  level,
  iconName,
  note,
}: {
  childId: string;
  level: MoodLevel;
  iconName: MoodIconName;
  /** Optional free-text note stored as a separate 'note' log_entry. */
  note?: string;
}): Promise<SaveMoodLogResult> {
  try {
    const supabase = createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { error: 'Not signed in. Please log in and try again.' };
    }

    const today = localISODate(); // local calendar date, not UTC

    // Step 1: Upsert daily_log — one per child per day per author
    const { data: log, error: logError } = await supabase
      .from('daily_logs')
      .upsert(
        { child_id: childId, log_date: today, author_id: user.id },
        { onConflict: 'child_id,log_date,author_id' },
      )
      .select('id')
      .single();

    if (logError || !log) {
      return { error: logError?.message ?? 'Failed to create daily log.' };
    }

    // Step 2: Insert mood log_entry
    const { data: entry, error: entryError } = await supabase
      .from('log_entries')
      .insert({
        daily_log_id: log.id,
        category: 'mood',
        value: {
          level,
          label: levelLabelMap[level],
          icon_name: iconNameMap[iconName],
        },
      })
      .select('id')
      .single();

    if (entryError || !entry) {
      return { error: entryError?.message ?? 'Failed to save mood entry.' };
    }

    // Step 3: Insert note log_entry if the user added one
    if (note) {
      const { error: noteError } = await supabase
        .from('log_entries')
        .insert({
          daily_log_id: log.id,
          category: 'note',
          value: { text: note },
        });

      if (noteError) {
        return { error: noteError.message ?? 'Failed to save note.' };
      }
    }

    return { entryId: entry.id };
  } catch {
    return { error: 'Network error. Please check your connection and try again.' };
  }
}

// ── getWeeklyStats ────────────────────────────────────────────

function emptyWeeklyStats(dates: string[]): WeeklyStats {
  return {
    total: 0,
    stats: MOOD_DISPLAY_ORDER.map((mood) => ({ mood, count: 0, pct: 0 })),
    byDate: dates.map((date) => ({ date, mood: null })),
    weekStart: dates[0],
    weekEnd: dates[6],
  };
}

/**
 * Aggregates the current user's logs for the last 7 local days.
 *
 * • Timezone-safe: the cutoff is local midnight → UTC, not a bare date string.
 * • RLS on the `logs` table guarantees only the caller's rows are returned —
 *   no explicit user_id filter needed in the query.
 * • Falls back to all-zero stats on network/auth error (non-critical path).
 */
export async function getWeeklyStats(): Promise<WeeklyStats> {
  const dates = last7LocalDates();

  try {
    const supabase = createClient();

    // Convert local midnight 6 days ago → UTC ISO string for Supabase filter
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 6);
    cutoffDate.setHours(0, 0, 0, 0); // midnight local time

    const { data, error } = await supabase
      .from('logs')
      .select('mood, created_at')
      .gte('created_at', cutoffDate.toISOString())
      .order('created_at', { ascending: true });

    if (error || !data || data.length === 0) return emptyWeeklyStats(dates);

    const rows = data as { mood: string; created_at: string }[];
    const total = rows.length;

    // Count per mood label
    const counts = new Map<string, number>(
      MOOD_DISPLAY_ORDER.map((m) => [m, 0]),
    );
    for (const row of rows) {
      counts.set(row.mood, (counts.get(row.mood) ?? 0) + 1);
    }

    const stats: MoodStat[] = MOOD_DISPLAY_ORDER.map((mood) => ({
      mood,
      count: counts.get(mood) ?? 0,
      pct: total > 0 ? Math.round(((counts.get(mood) ?? 0) / total) * 100) : 0,
    }));

    // Last mood logged per local calendar date (used for day-dot timeline)
    const moodByDate = new Map<string, MoodLabel>();
    for (const row of rows) {
      moodByDate.set(localISODate(new Date(row.created_at)), row.mood as MoodLabel);
    }

    const byDate = dates.map((date) => ({
      date,
      mood: (moodByDate.get(date) ?? null) as MoodLabel | null,
    }));

    return { total, stats, byDate, weekStart: dates[0], weekEnd: dates[6] };
  } catch {
    return emptyWeeklyStats(dates);
  }
}

// ── getWeeklyRadarStats ───────────────────────────────────────

const MOOD_SCORE: Record<MoodLabel, number> = {
  Great: 5, Good: 4, Okay: 3, 'Not Great': 2, 'Very Low': 1,
};

/** One column in the Weekly Mood Radar (Mon–Sun). */
export interface WeekDayData {
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  date: string;              // YYYY-MM-DD local
  isFuture: boolean;         // day hasn't arrived yet in the current week
  isToday: boolean;
  avgScore: number | null;   // 1–5 weighted average; null = no logs
  total: number;
  counts: Record<MoodLabel, number>;
}

export interface WeeklyRadarStats {
  days: WeekDayData[];        // 7 entries, Mon first
  weekStart: string;          // Monday YYYY-MM-DD
  weekEnd: string;            // Sunday YYYY-MM-DD
  hasData: boolean;
  outlierIdx: number | null;  // index of the "challenging" outlier day
  insightText: string | null;
}

/** Monday of the current local week at local midnight. */
function getMondayOfCurrentWeek(): Date {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun
  const offset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function buildRadarResult(days: WeekDayData[]): WeeklyRadarStats {
  const daysWithData = days.filter((d) => !d.isFuture && d.avgScore !== null);
  const hasData = daysWithData.length > 0;

  // Outlier: worst day that is ≥ 0.8 below mean AND avgScore ≤ 2.5
  let outlierIdx: number | null = null;
  if (daysWithData.length >= 2) {
    const mean = daysWithData.reduce((s, d) => s + d.avgScore!, 0) / daysWithData.length;
    const worst = daysWithData.reduce((a, b) => (b.avgScore! < a.avgScore! ? b : a));
    if (worst.avgScore! <= 2.5 && mean - worst.avgScore! >= 0.8) {
      outlierIdx = days.indexOf(worst);
    }
  }

  // Smart insight text
  let insightText: string | null = null;
  if (hasData) {
    const best  = daysWithData.reduce((a, b) => (b.avgScore! > a.avgScore! ? b : a));
    const worst = daysWithData.reduce((a, b) => (b.avgScore! < a.avgScore! ? b : a));
    if (outlierIdx !== null) {
      insightText = `💡 ${days[outlierIdx].day} was more challenging — but ${best.day} showed a brighter mood.`;
    } else if (daysWithData.every((d) => d.avgScore! >= 3.5)) {
      insightText = '💡 Strong week — moods have been consistently positive.';
    } else if (daysWithData.length === 1) {
      insightText = `💡 ${daysWithData[0].day} is logged. Keep going for the full picture!`;
    } else if (best.avgScore! - worst.avgScore! > 0.5) {
      insightText = `💡 ${best.day} was the high point of the week.`;
    } else {
      insightText = '💡 A fairly balanced week overall.';
    }
  }

  return {
    days,
    weekStart: days[0].date,
    weekEnd: days[6].date,
    hasData,
    outlierIdx,
    insightText,
  };
}

/**
 * Fetches logs for the current natural week (Mon 00:00 → Sun 23:59 local),
 * aggregates by day, and computes a per-day avgScore (1–5).
 * Future days are flagged with `isFuture: true` and `avgScore: null`.
 */
export async function getWeeklyRadarStats(): Promise<WeeklyRadarStats> {
  const monday = getMondayOfCurrentWeek();
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const todayISO = localISODate();
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

  const days: WeekDayData[] = DAY_NAMES.map((day, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateISO = localISODate(d);
    return {
      day,
      date: dateISO,
      isFuture: dateISO > todayISO,
      isToday: dateISO === todayISO,
      avgScore: null,
      total: 0,
      counts: Object.fromEntries(
        MOOD_DISPLAY_ORDER.map((m) => [m, 0]),
      ) as Record<MoodLabel, number>,
    };
  });

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('logs')
      .select('mood, created_at')
      .gte('created_at', monday.toISOString())
      .lte('created_at', sunday.toISOString());

    if (error || !data || data.length === 0) return buildRadarResult(days);

    for (const row of data as { mood: string; created_at: string }[]) {
      const dateISO = localISODate(new Date(row.created_at));
      const idx = days.findIndex((d) => d.date === dateISO);
      if (idx === -1) continue;
      const mood = row.mood as MoodLabel;
      if (!(mood in days[idx].counts)) continue;
      days[idx].counts[mood]++;
      days[idx].total++;
    }

    for (const day of days) {
      if (day.total === 0) continue;
      day.avgScore =
        MOOD_DISPLAY_ORDER.reduce((acc, m) => acc + MOOD_SCORE[m] * day.counts[m], 0) /
        day.total;
    }

    return buildRadarResult(days);
  } catch {
    return buildRadarResult(days);
  }
}

// ── getDayOfWeekStats ─────────────────────────────────────────

/** Day-of-week labels, Mon first (matches JS getDay() offset below). */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type WeekdayLabel = typeof WEEKDAY_LABELS[number];

/** Mood distribution for one weekday. */
export interface DayPattern {
  day: WeekdayLabel;
  total: number;
  /** Per-mood counts, same order as MOOD_DISPLAY_ORDER. */
  counts: Record<MoodLabel, number>;
  /** Proportion of Great + Good entries (0–1). */
  positiveRatio: number;
  /** Proportion of Very Low + Not Great entries (0–1). */
  lowRatio: number;
}

/** Full 30-day weekly-pattern payload. */
export interface WeeklyPatternStats {
  patterns: DayPattern[];     // length 7, Mon first; total may be 0
  bestDay: WeekdayLabel | null;   // highest positiveRatio (null if no data)
  hardestDay: WeekdayLabel | null; // highest lowRatio (null if no data)
  hasData: boolean;
}

/**
 * Aggregates the current user's `logs` rows for the past 30 local days,
 * grouped by day of week (Monday–Sunday).
 *
 * • Timezone-safe: cutoff is local midnight → UTC, same pattern as getWeeklyStats.
 * • Returns all-zero patterns on error (non-critical path).
 */
export async function getDayOfWeekStats(): Promise<WeeklyPatternStats> {
  const emptyPatterns = (): DayPattern[] =>
    WEEKDAY_LABELS.map((day) => ({
      day,
      total: 0,
      counts: Object.fromEntries(MOOD_DISPLAY_ORDER.map((m) => [m, 0])) as Record<MoodLabel, number>,
      positiveRatio: 0,
      lowRatio: 0,
    }));

  try {
    const supabase = createClient();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 29); // 30 days inclusive
    cutoff.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('logs')
      .select('mood, created_at')
      .gte('created_at', cutoff.toISOString());

    if (error || !data || data.length === 0) {
      return { patterns: emptyPatterns(), bestDay: null, hardestDay: null, hasData: false };
    }

    const rows = data as { mood: string; created_at: string }[];
    const patterns = emptyPatterns();

    for (const row of rows) {
      const jsDay = new Date(row.created_at).getDay(); // 0=Sun … 6=Sat
      // Remap: Sun(0)→6, Mon(1)→0, …, Sat(6)→5
      const idx = jsDay === 0 ? 6 : jsDay - 1;
      const mood = row.mood as MoodLabel;
      if (!(mood in patterns[idx].counts)) continue;
      patterns[idx].counts[mood]++;
      patterns[idx].total++;
    }

    // Compute ratios
    for (const p of patterns) {
      if (p.total === 0) continue;
      p.positiveRatio = (p.counts['Great'] + p.counts['Good']) / p.total;
      p.lowRatio = (p.counts['Very Low'] + p.counts['Not Great']) / p.total;
    }

    const daysWithData = patterns.filter((p) => p.total > 0);
    if (daysWithData.length === 0) {
      return { patterns, bestDay: null, hardestDay: null, hasData: false };
    }

    const bestDay = daysWithData.reduce((a, b) =>
      b.positiveRatio > a.positiveRatio ? b : a,
    ).day;

    const hardestDay = daysWithData.reduce((a, b) =>
      b.lowRatio > a.lowRatio ? b : a,
    ).day;

    return { patterns, bestDay, hardestDay, hasData: true };
  } catch {
    return { patterns: emptyPatterns(), bestDay: null, hardestDay: null, hasData: false };
  }
}

// ── AI Insights ───────────────────────────────────────────────

/** Tomorrow prediction derived from historical day-of-week patterns. */
export interface ForecastInsight {
  tomorrowDay: string;
  hasConcern: boolean;   // true → warning style
  message: string;
}

/** A keyword correlated with positive or negative moods. */
export interface KeywordTag {
  word: string;
  sentiment: 'positive' | 'negative';
  count: number;
}

/** Low→high mood recovery speed, compared to previous week. */
export interface ResilienceInsight {
  currentAvgHours: number;
  previousAvgHours: number | null;
  improvementPct: number | null;   // positive = faster recovery
  message: string;
}

/** Full AI Counselor payload returned by getAIInsights(). */
export interface AIInsights {
  forecast: ForecastInsight | null;
  keywords: KeywordTag[];
  resilience: ResilienceInsight | null;
  notesWithTextCount: number;
  isLearning: boolean;             // true when < 10 real notes — show privacy gate
  biometricCorrelation: string | null; // null = not enough metadata
  /** Child's age in full years, derived from child_birthday in profile. */
  childAgeYears?: number;
  /** Human-readable developmental stage label. */
  developmentalStage?: string;
}

// ── Age & developmental stage helpers ────────────────────────

/**
 * Computes full years from a YYYY-MM-DD birthday string to today (local time).
 * Returns undefined if the birthday string is empty or invalid.
 */
function computeAgeYears(birthday: string | undefined): number | undefined {
  if (!birthday) return undefined;
  const bday = new Date(`${birthday}T12:00:00`); // noon avoids tz edge cases
  if (isNaN(bday.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - bday.getFullYear();
  const m = today.getMonth() - bday.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bday.getDate())) age--;
  return Math.max(0, age);
}

interface DevStage {
  label: string;
  /** One-liner shown inside the forecast card when hasConcern = true. */
  hint: string;
}

function getDevStage(ageYears: number): DevStage {
  if (ageYears < 4)  return { label: 'Toddler (< 4 yrs)',              hint: 'Consistency and predictability matter most at this age.' };
  if (ageYears < 6)  return { label: 'Preschool (4–5 yrs)',            hint: 'Short, clear routines and visual cues work best at this age.' };
  if (ageYears < 10) return { label: 'Early school age (6–9 yrs)',     hint: 'Structured transitions and predictable schedules are especially helpful at this age.' };
  if (ageYears < 13) return { label: 'Pre-teen (10–12 yrs)',           hint: 'Social dynamics and peer connections are growing in importance.' };
  return               { label: 'Teenager (13+ yrs)',                  hint: 'Autonomy and emotional validation are key at this stage.' };
}

// ── helpers (AI-only) ─────────────────────────────────────────

const STOP_WORDS = new Set([
  'i','a','an','the','is','it','was','he','she','they','we','you',
  'to','and','or','in','on','at','for','with','my','his','her',
  'had','has','been','be','are','were','this','that','of','but',
  'so','not','do','did','have','from','by','as','if','up','day',
  'today','log','mock','seeded','time','machine','auto','generated',
  'entry','testing','quick','just','get','got','went','felt','feel',
  'mood','good','great','okay','low','very','really','bit','little',
  'also','then','when','what','how','its','our','their','will','can',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,\.!?;:'"()\-\/\d]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function calcAvgRecoveryHours(
  entries: { mood: string; created_at: string }[],
): number | null {
  const recoveries: number[] = [];
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    const prevScore = MOOD_SCORE[prev.mood as MoodLabel] ?? 3;
    const currScore = MOOD_SCORE[curr.mood as MoodLabel] ?? 3;
    if (prevScore <= 2 && currScore >= 4) {
      const hours =
        (new Date(curr.created_at).getTime() -
          new Date(prev.created_at).getTime()) /
        3_600_000;
      if (hours <= 72) recoveries.push(hours); // cap at 3 days
    }
  }
  return recoveries.length === 0
    ? null
    : recoveries.reduce((s, h) => s + h, 0) / recoveries.length;
}

/**
 * Computes three AI-powered insights from the last 30 days of logs:
 *   1. Tomorrow Forecast   — historical low-ratio for that weekday
 *   2. Keyword Tags        — words correlated with positive / negative moods
 *   3. Resilience Score    — average low→high recovery hours vs. last week
 *
 * Privacy gate: keyword section requires ≥ 10 real-note logs.
 * All sections degrade gracefully to null / [] on insufficient data.
 */
export async function getAIInsights(): Promise<AIInsights> {
  const supabase = createClient();

  // Read profile to get child's birthday (non-blocking — silently ignored on error).
  // If no birthday is stored yet, fall back to the configured default (Nov 2019).
  // This ensures age-aware slogans and dev-stage hints work from day one.
  const BIRTHDAY_FALLBACK = '2019-11-01';
  const childProfile = await getProfile().catch(() => null);
  const resolvedBirthday = childProfile?.child_birthday || BIRTHDAY_FALLBACK;
  const childAgeYears = computeAgeYears(resolvedBirthday);
  const devStage = childAgeYears !== undefined ? getDevStage(childAgeYears) : undefined;

  // One query: 30 days of mood + note + timestamp, ordered oldest first
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 29);
  cutoff.setHours(0, 0, 0, 0);

  // Try the full column set (post-migration includes metadata).
  // If 42703 "undefined_column" comes back, retry without metadata — the AI
  // insights that depend on biometrics will simply return null for this session.
  type LogRow = { mood: string; note: string | null; created_at: string; metadata: LogMetadata | null };

  const fullResult = await supabase
    .from('logs')
    .select('mood, note, created_at, metadata')
    .gte('created_at', cutoff.toISOString())
    .order('created_at', { ascending: true });

  let rawLogs: unknown[] = fullResult.data ?? [];
  if (isMissingColumnError(fullResult.error)) {
    const base = await supabase
      .from('logs')
      .select('mood, note, created_at')
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: true });
    rawLogs = base.data ?? [];
  }

  const logs = rawLogs as LogRow[];

  // Real notes (exclude null, whitespace-only, and mock tags)
  const notesWithText = logs.filter(
    (l) =>
      l.note &&
      l.note.trim().length > 2 &&
      !l.note.includes('Seeded via time machine'),
  );
  const notesWithTextCount = notesWithText.length;
  const isLearning = notesWithTextCount < 10;

  // ── 1. Tomorrow Forecast ─────────────────────────────────────
  let forecast: ForecastInsight | null = null;
  try {
    const patternStats = await getDayOfWeekStats();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const jsDay = tomorrow.getDay();
    const idx = jsDay === 0 ? 6 : jsDay - 1; // Mon-first

    const DAY_NAMES = [
      'Monday', 'Tuesday', 'Wednesday',
      'Thursday', 'Friday', 'Saturday', 'Sunday',
    ];
    const tomorrowName = DAY_NAMES[idx];
    const pat = patternStats.patterns[idx];
    const daysWithData = patternStats.patterns.filter((p) => p.total >= 3);

    if (pat.total >= 3 && daysWithData.length >= 2) {
      const avgLow = daysWithData.reduce((s, p) => s + p.lowRatio, 0) / daysWithData.length;
      const avgPos = daysWithData.reduce((s, p) => s + p.positiveRatio, 0) / daysWithData.length;
      const lowPct = Math.round(pat.lowRatio * 100);
      const posPct = Math.round(pat.positiveRatio * 100);

      if (pat.lowRatio > avgLow + 0.15) {
        forecast = {
          tomorrowDay: tomorrowName,
          hasConcern: true,
          message: `⚠️ Tomorrow is ${tomorrowName}. Historically, ${lowPct}% of ${tomorrowName}s have been tough.`,
        };
      } else if (pat.positiveRatio > avgPos + 0.15) {
        forecast = {
          tomorrowDay: tomorrowName,
          hasConcern: false,
          message: `✨ Tomorrow is ${tomorrowName} — historically one of the brighter days (${posPct}% positive). A great time to plan something fun!`,
        };
      } else {
        forecast = {
          tomorrowDay: tomorrowName,
          hasConcern: false,
          message: `🌤️ Tomorrow is ${tomorrowName}. Based on past patterns, it should be a fairly typical day.`,
        };
      }
    }
  } catch {
    // forecast stays null — non-critical
  }

  // ── 2. Keyword Sentiment Tags ────────────────────────────────
  const keywords: KeywordTag[] = [];

  if (!isLearning) {
    const posFreq = new Map<string, number>();
    const negFreq = new Map<string, number>();
    const totalFreq = new Map<string, number>();

    for (const log of notesWithText) {
      const tokens = tokenize(log.note!);
      const isPos = log.mood === 'Great' || log.mood === 'Good';
      const isNeg = log.mood === 'Very Low' || log.mood === 'Not Great';
      for (const w of tokens) {
        totalFreq.set(w, (totalFreq.get(w) ?? 0) + 1);
        if (isPos) posFreq.set(w, (posFreq.get(w) ?? 0) + 1);
        if (isNeg) negFreq.set(w, (negFreq.get(w) ?? 0) + 1);
      }
    }

    const candidates: KeywordTag[] = [];
    for (const [word, total] of totalFreq) {
      if (total < 2) continue;
      const pos = posFreq.get(word) ?? 0;
      const neg = negFreq.get(word) ?? 0;
      if (pos >= 2 && pos >= neg * 2.5)
        candidates.push({ word, sentiment: 'positive', count: pos });
      else if (neg >= 2 && neg >= pos * 2.5)
        candidates.push({ word, sentiment: 'negative', count: neg });
    }

    candidates.sort((a, b) => b.count - a.count);
    keywords.push(
      ...candidates.filter((c) => c.sentiment === 'positive').slice(0, 6),
      ...candidates.filter((c) => c.sentiment === 'negative').slice(0, 6),
    );
  }

  // ── 3. Resilience Score ──────────────────────────────────────
  let resilience: ResilienceInsight | null = null;

  const monday = getMondayOfCurrentWeek();
  const lastMonday = new Date(monday);
  lastMonday.setDate(monday.getDate() - 7);

  const thisWeek = logs.filter((l) => new Date(l.created_at) >= monday);
  const lastWeek = logs.filter((l) => {
    const d = new Date(l.created_at);
    return d >= lastMonday && d < monday;
  });

  const currentAvg = calcAvgRecoveryHours(thisWeek);
  const previousAvg = calcAvgRecoveryHours(lastWeek);

  if (currentAvg !== null) {
    let improvementPct: number | null = null;
    let message: string;

    if (previousAvg !== null && previousAvg > 0) {
      improvementPct = ((previousAvg - currentAvg) / previousAvg) * 100;
      if (improvementPct > 10) {
        message = `💪 Bouncing back ${Math.round(improvementPct)}% faster than last week — the resilience muscle is growing!`;
      } else if (improvementPct < -10) {
        message = `🌱 Recovery is taking a bit longer this week (${Math.round(currentAvg)}h avg). Extra patience and care can help.`;
      } else {
        message = `⚖️ Steady recovery pace — averaging ${Math.round(currentAvg)} hours to bounce back from a tough mood.`;
      }
    } else {
      message = `💪 Showing resilience this week — bouncing back in about ${Math.round(currentAvg)} hours on average.`;
    }

    resilience = {
      currentAvgHours: currentAvg,
      previousAvgHours: previousAvg,
      improvementPct,
      message,
    };
  }

  // ── 4. Biometric Correlation ─────────────────────────────────
  let biometricCorrelation: string | null = null;

  const logsWithMeta = logs.filter((l) => l.metadata != null);

  if (logsWithMeta.length >= 5) {
    const baseAvg =
      logs.reduce((s, l) => s + (MOOD_SCORE[l.mood as MoodLabel] ?? 3), 0) /
      logs.length;

    // High-activity correlation (steps ≥ 12 000)
    const highActivity = logsWithMeta.filter(
      (l) => (l.metadata!.steps ?? 0) >= 12_000,
    );
    if (highActivity.length >= 3) {
      const actAvg =
        highActivity.reduce((s, l) => s + (MOOD_SCORE[l.mood as MoodLabel] ?? 3), 0) /
        highActivity.length;
      if (baseAvg - actAvg >= 0.5) {
        biometricCorrelation = `📊 We noticed a link between high activity and lower mood. On days with 12 000+ steps, mood averaged ${actAvg.toFixed(1)}/5 vs ${baseAvg.toFixed(1)}/5 overall.`;
      }
    }

    // Low-sleep correlation (sleep < 6 h)
    if (!biometricCorrelation) {
      const lowSleep = logsWithMeta.filter(
        (l) => (l.metadata!.sleep_hours ?? 99) < 6,
      );
      if (lowSleep.length >= 3) {
        const sleepAvg =
          lowSleep.reduce((s, l) => s + (MOOD_SCORE[l.mood as MoodLabel] ?? 3), 0) /
          lowSleep.length;
        if (baseAvg - sleepAvg >= 0.5) {
          biometricCorrelation = `📊 Sleep matters: on days with under 6 h of sleep, mood averaged ${sleepAvg.toFixed(1)}/5 vs ${baseAvg.toFixed(1)}/5 on well-rested days.`;
        }
      }
    }
  }

  return {
    forecast,
    keywords,
    resilience,
    notesWithTextCount,
    isLearning,
    biometricCorrelation,
    childAgeYears,
    developmentalStage: devStage?.label,
  };
}

// ── getTodayMetadata ──────────────────────────────────────────

/**
 * Returns the most recent LogMetadata recorded today (local date),
 * or null if no log with metadata exists yet today.
 */
export async function getTodayMetadata(): Promise<LogMetadata | null> {
  try {
    const supabase = createClient();
    const today = localISODate();
    const startOfDay = new Date(`${today}T00:00:00`);

    const { data, error } = await supabase
      .from('logs')
      .select('metadata')
      .gte('created_at', startOfDay.toISOString())
      .not('metadata', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);

    // 42703 = metadata column doesn't exist yet (pre-migration) — return null gracefully
    if (isMissingColumnError(error) || !data || data.length === 0) return null;
    return (data[0] as { metadata: LogMetadata | null }).metadata;
  } catch {
    return null;
  }
}

// ── getRecentLogs ─────────────────────────────────────────────

/**
 * Fetches the most recent `limit` rows from the `logs` table for the current
 * authenticated user, ordered newest-first.
 * Returns [] on auth failure or network error (non-critical path).
 */
export async function getRecentLogs(limit = 10): Promise<LogEntry[]> {
  try {
    const supabase = createClient();

    // Fetch the current user's profile in parallel with the log query.
    // All MVP logs belong to auth.uid() (RLS), so the profile is the author
    // for every entry shown. This gives us attribution even before the DB
    // migration adds author_name / author_role columns to the logs table.
    const [logsResult, { data: { user } }] = await Promise.all([
      supabase
        .from('logs')
        .select('id, mood, note, created_at, author_name, author_role')
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase.auth.getUser(),
    ]);

    // Resolve author from profile (non-critical — silent on error)
    let profileName: string | null = null;
    let profileRole: 'parent' | 'teacher' | 'therapist' | null = null;
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, role')
        .eq('id', user.id)
        .single();
      if (profile) {
        const p = profile as { display_name: string; role: string };
        profileName = p.display_name;
        profileRole = (p.role === 'teacher' || p.role === 'therapist') ? p.role : 'parent';
      } else {
        // profiles table missing or no row yet — fall back to localStorage then auth metadata
        const local = readLocalProfile();
        if (local) {
          profileName = local.display_name || null;
          profileRole = local.role;
        } else {
          const meta = user.user_metadata as Record<string, string> | null;
          profileName =
            meta?.full_name ??
            meta?.name ??
            (user.email ? user.email.split('@')[0] : null);
          profileRole = 'parent';
        }
      }
    }

    // Build the entries list.
    // Post-migration: author_name/author_role come from the DB row itself.
    // Pre-migration (PGRST204 / 42703): fall back to base columns and stamp
    //   the current user's profile on every entry so attribution shows now.
    let rows: { id: string; mood: string; note: string | null; created_at: string; author_name?: string | null; author_role?: string | null }[];

    if (isMissingColumnError(logsResult.error)) {
      const fallback = await supabase
        .from('logs')
        .select('id, mood, note, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (fallback.error) return [];
      rows = (fallback.data ?? []) as typeof rows;
    } else {
      if (logsResult.error) return [];
      rows = (logsResult.data ?? []) as typeof rows;
    }

    // Stamp profile attribution on any row that is missing it
    return rows.map((row) => ({
      ...row,
      author_name: row.author_name ?? profileName,
      author_role: (row.author_role ?? profileRole) as LogEntry['author_role'],
    }));
  } catch {
    return [];
  }
}

// ── getWeeklyLogs ─────────────────────────────────────────────

/**
 * Fetches mood entries for `childId` over the last 7 local days and groups
 * by date. Days without a mood entry are `level: null`.
 * Returns an all-null week on network failure (trend is non-critical).
 */
export async function getWeeklyLogs(childId: string): Promise<DayMood[]> {
  const dates = last7LocalDates();
  const sevenDaysAgo = dates[0];

  try {
    const supabase = createClient();

    const { data } = await supabase
      .from('daily_logs')
      .select('log_date, log_entries(category, value)')
      .eq('child_id', childId)
      .gte('log_date', sevenDaysAgo)
      .order('log_date', { ascending: true });

    type RawRow = { log_date: string; log_entries: Array<{ category: string; value: unknown }> };
    const levelByDate = new Map<string, 1 | 2 | 3 | 4 | 5>();

    for (const row of (data ?? []) as RawRow[]) {
      const moodEntry = row.log_entries.find((e) => e.category === 'mood');
      if (moodEntry) {
        const level = (moodEntry.value as { level: number }).level as 1 | 2 | 3 | 4 | 5;
        levelByDate.set(row.log_date, level);
      }
    }

    return dates.map((date) => ({
      date,
      level: levelByDate.get(date) ?? null,
    }));
  } catch {
    return dates.map((date) => ({ date, level: null }));
  }
}

// ── getTodayLogs ──────────────────────────────────────────────

/**
 * For each child in `childIds`, checks whether a mood log_entry exists for
 * today (local date). Returns a Map<child_id, mood_level> so the UI can
 * render checkmarks without additional lookups.
 *
 * Queries across all authors — captures both parent-logged and teacher-logged
 * entries for the same child.
 *
 * Returns an empty Map on network failure (non-critical path).
 */
export async function getTodayLogs(
  childIds: string[],
): Promise<Map<string, 1 | 2 | 3 | 4 | 5>> {
  const result = new Map<string, 1 | 2 | 3 | 4 | 5>();
  if (childIds.length === 0) return result;

  try {
    const supabase = createClient();
    const today = localISODate(); // local calendar date, not UTC

    const { data } = await supabase
      .from('daily_logs')
      .select('child_id, log_entries(category, value)')
      .in('child_id', childIds)
      .eq('log_date', today);

    type RawRow = { child_id: string; log_entries: Array<{ category: string; value: unknown }> };

    for (const row of (data ?? []) as RawRow[]) {
      if (result.has(row.child_id)) continue; // first mood entry wins
      const moodEntry = row.log_entries.find((e) => e.category === 'mood');
      if (moodEntry) {
        const level = (moodEntry.value as { level: number }).level as 1 | 2 | 3 | 4 | 5;
        result.set(row.child_id, level);
      }
    }
  } catch {
    // Non-critical; caller treats an empty Map as "no entries yet"
  }

  return result;
}

// ── getDailyProgress ──────────────────────────────────────────

/**
 * Counts how many of the given children have at least one mood entry today.
 * Returns { logged, total } for the progress bar.
 *
 * Performance notes:
 *   • Uses `!inner` join so the DB filters rows before returning them —
 *     children without any mood entry never appear in the response.
 *   • Selects only `child_id` (no `value` JSONB column) — minimal payload.
 *   • A Set deduplicates children who have >1 author entry on the same day.
 *
 * Returns { logged: 0, total } on network failure (non-critical path).
 */
export async function getDailyProgress(
  childIds: string[],
): Promise<{ logged: number; total: number }> {
  const total = childIds.length;
  if (total === 0) return { logged: 0, total: 0 };

  try {
    const supabase = createClient();
    const today = localISODate();

    const { data } = await supabase
      .from('daily_logs')
      .select('child_id, log_entries!inner(category)')
      .in('child_id', childIds)
      .eq('log_date', today)
      .eq('log_entries.category', 'mood');

    const logged = new Set(
      (data ?? []).map((r) => (r as { child_id: string }).child_id),
    ).size;

    return { logged, total };
  } catch {
    return { logged: 0, total };
  }
}
