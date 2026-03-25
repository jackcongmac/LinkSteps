"use client";

import { Sun, Smile, Cloud, CloudRain, Zap } from "lucide-react";
import type { LogEntry } from "@/lib/mood-log";

// ── Mood config ───────────────────────────────────────────────

const MOOD_CONFIG: Record<
  string,
  {
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    iconColor: string;
    dotColor: string;
  }
> = {
  Great:       { Icon: Sun,       iconColor: "text-sky-500",     dotColor: "bg-sky-400"     },
  Good:        { Icon: Smile,     iconColor: "text-emerald-500", dotColor: "bg-emerald-400" },
  Okay:        { Icon: Cloud,     iconColor: "text-slate-400",   dotColor: "bg-slate-300"   },
  "Not Great": { Icon: CloudRain, iconColor: "text-amber-500",   dotColor: "bg-amber-400"   },
  "Very Low":  { Icon: Zap,       iconColor: "text-rose-400",    dotColor: "bg-rose-400"    },
};

const FALLBACK = MOOD_CONFIG["Okay"];

// ── Date helpers ──────────────────────────────────────────────

/** YYYY-MM-DD in local time for a given Date. */
function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Human-readable group header: "Today, Mar 24" / "Yesterday, Mar 23" / "Mar 22" */
function formatGroupHeader(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00`);
  const now = new Date();
  const todayKey = toLocalDateKey(now);
  const yesterdayKey = toLocalDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

  const monthDay = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  if (dateKey === todayKey) return `Today, ${monthDay}`;
  if (dateKey === yesterdayKey) return `Yesterday, ${monthDay}`;
  return monthDay;
}

/** "12:42 PM" */
function formatTimeOnly(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ── Grouping ──────────────────────────────────────────────────

interface Group {
  dateKey: string;
  entries: LogEntry[];
}

function groupByDate(entries: LogEntry[]): Group[] {
  const map = new Map<string, LogEntry[]>();
  for (const entry of entries) {
    const key = toLocalDateKey(new Date(entry.created_at));
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(entry);
  }
  // Entries arrive newest-first; sort keys descending
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, entries]) => ({ dateKey, entries }));
}

// ── Component ─────────────────────────────────────────────────

interface RecentLogsProps {
  entries: LogEntry[];
  loading?: boolean;
}

export default function RecentLogs({ entries, loading = false }: RecentLogsProps) {
  // ── Skeleton ────────────────────────────────────────────────
  if (loading && entries.length === 0) {
    return (
      <div className="space-y-5 px-1" aria-hidden="true">
        {/* Fake group header */}
        <div className="h-3.5 w-24 animate-pulse rounded-full bg-slate-200" />
        <div className="ml-3 space-y-5 border-l-2 border-slate-100 pl-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="relative animate-pulse">
              {/* Dot */}
              <div className="absolute -left-[1.625rem] top-1 h-3 w-3 rounded-full bg-slate-200" />
              <div className="h-3 w-14 rounded-full bg-slate-200" />
              <div className="mt-1.5 h-2.5 w-28 rounded-full bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────
  if (!loading && entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-400">
        No logs yet — save your first mood above!
      </p>
    );
  }

  // ── Timeline ─────────────────────────────────────────────────
  const groups = groupByDate(entries);

  return (
    <section aria-label="Daily log timeline" className="space-y-5 px-1">
      {groups.map(({ dateKey, entries: dayEntries }) => (
        <div key={dateKey}>
          {/* Date header */}
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {formatGroupHeader(dateKey)}
          </h2>

          {/* Timeline track */}
          <div className="relative ml-3 border-l-2 border-slate-100 pl-5">
            <div className="space-y-4">
              {dayEntries.map((entry) => {
                const cfg = MOOD_CONFIG[entry.mood] ?? FALLBACK;
                const { Icon, iconColor, dotColor } = cfg;

                return (
                  <div key={entry.id} className="relative">
                    {/* Mood-coloured dot on the timeline */}
                    <div
                      className={`absolute -left-[1.625rem] top-1 h-3 w-3 rounded-full ring-2 ring-white ${dotColor}`}
                      aria-hidden="true"
                    />

                    {/* Entry body */}
                    <div className="flex items-start gap-2.5">
                      {/* Mood icon */}
                      <Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`}
                        aria-hidden="true"
                      />

                      {/* Text */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium text-slate-700">
                            {entry.mood}
                          </span>
                          <span className="text-xs text-slate-400">
                            {formatTimeOnly(entry.created_at)}
                          </span>
                        </div>

                        {entry.note && (
                          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                            {entry.note}
                          </p>
                        )}

                        {/* Author attribution — optional chaining: silent if fields absent */}
                        {entry?.author_name && (
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            <span aria-hidden="true">
                              {entry?.author_role === 'teacher'    ? '🎒'
                               : entry?.author_role === 'therapist' ? '🧩'
                               : '🏠'}
                            </span>{' '}
                            by {entry.author_name}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
