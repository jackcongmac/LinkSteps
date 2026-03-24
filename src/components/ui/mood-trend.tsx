"use client";

import { TrendingUp } from "lucide-react";
import type { DayMood } from "@/lib/mood-log";

// ── Colour + label maps ──────────────────────────────────────

const DOT_COLOR: Record<1 | 2 | 3 | 4 | 5, string> = {
  5: "bg-sky-500",
  4: "bg-sky-300",
  3: "bg-slate-300",
  2: "bg-rose-300",
  1: "bg-rose-400",
};

const LEVEL_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = {
  5: "Great",
  4: "Good",
  3: "Okay",
  2: "Not Great",
  1: "Very Low",
};

// ── Helpers ──────────────────────────────────────────────────

const TODAY = new Date().toISOString().split("T")[0];

/** "Mo" | "Tu" | "We" | "Th" | "Fr" | "Sa" | "Su" — avoids single-letter ambiguity */
function shortWeekday(dateStr: string): string {
  // Add T12 to avoid date shifting due to local TZ offset
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2);
}

// ── Component ────────────────────────────────────────────────

interface MoodTrendProps {
  /** Exactly 7 entries, oldest → newest. Produced by getWeeklyLogs(). */
  data: DayMood[];
}

export default function MoodTrend({ data }: MoodTrendProps) {
  const hasAnyEntry = data.some((d) => d.level !== null);

  return (
    <section
      className="rounded-3xl bg-white p-5 shadow-sm"
      aria-label="Mood trend — last 7 days"
    >
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-sky-600" aria-hidden="true" />
        <h3 className="text-sm font-medium text-slate-700">Last 7 Days</h3>
      </div>

      {/* Dot row — always rendered to prevent layout collapse */}
      <div
        className="flex items-end justify-between gap-1"
        role="list"
        aria-label="Daily mood dots"
      >
        {data.map((day) => {
          const isToday = day.date === TODAY;
          const dotColor = day.level !== null ? DOT_COLOR[day.level] : "bg-slate-200";
          const moodLabel = day.level !== null ? LEVEL_LABEL[day.level] : "No entry";
          const dayLabel = isToday ? "Today" : shortWeekday(day.date);

          return (
            <div
              key={day.date}
              role="listitem"
              className="flex flex-1 flex-col items-center gap-2"
              aria-label={`${dayLabel}: ${moodLabel}`}
            >
              {/* Mood dot */}
              <div
                className={[
                  "h-3 w-3 rounded-full transition-colors",
                  dotColor,
                  isToday ? "ring-2 ring-sky-400 ring-offset-1" : "",
                ].join(" ")}
                aria-hidden="true"
              />
              {/* Day label */}
              <span
                className={`text-xs leading-none ${
                  isToday ? "font-semibold text-sky-600" : "text-slate-400"
                }`}
              >
                {dayLabel}
              </span>
            </div>
          );
        })}
      </div>

      {/* Empty state caption — shown below the dots, never replaces them */}
      {!hasAnyEntry && (
        <p className="mt-4 text-center text-xs text-slate-400">
          No mood entries yet.{" "}
          <span className="text-slate-500">Start logging to see your week.</span>
        </p>
      )}
    </section>
  );
}
