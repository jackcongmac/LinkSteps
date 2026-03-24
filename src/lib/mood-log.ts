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
