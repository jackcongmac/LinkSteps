"use client";

import { useEffect, useState } from "react";
import { Sun, Smile, Cloud, CloudRain, Zap } from "lucide-react";
import { getWeeklyRadarStats, getDayOfWeekStats, getAIInsights } from "@/lib/mood-log";
import type {
  WeeklyRadarStats, WeekDayData, MoodLabel,
  WeeklyPatternStats, AIInsights, KeywordTag,
} from "@/lib/mood-log";
import AppNav from "@/components/ui/app-nav";

// ── Shared mood palette ────────────────────────────────────────

const MOOD_CONFIG: Record<
  MoodLabel,
  {
    Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    iconColor: string;
    barColor: string;
  }
> = {
  Great:       { Icon: Sun,       iconColor: "text-sky-500",     barColor: "bg-sky-400"     },
  Good:        { Icon: Smile,     iconColor: "text-emerald-500", barColor: "bg-emerald-400" },
  Okay:        { Icon: Cloud,     iconColor: "text-slate-400",   barColor: "bg-slate-300"   },
  "Not Great": { Icon: CloudRain, iconColor: "text-amber-500",   barColor: "bg-amber-400"   },
  "Very Low":  { Icon: Zap,       iconColor: "text-rose-400",    barColor: "bg-rose-400"    },
};

const MOOD_DISPLAY_ORDER: MoodLabel[] = ["Great", "Good", "Okay", "Not Great", "Very Low"];

// ── Helpers ───────────────────────────────────────────────────

function fmtDateRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function fmtShortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** bar colour based on avgScore bucket */
function scoreBarColor(score: number): string {
  if (score >= 4.0) return "bg-sky-400";
  if (score >= 3.0) return "bg-emerald-400";
  if (score >= 2.0) return "bg-amber-400";
  return "bg-rose-400";
}

// ── Page ──────────────────────────────────────────────────────

export default function InsightsPage() {
  const [radar,   setRadar]   = useState<WeeklyRadarStats | null>(null);
  const [pattern, setPattern] = useState<WeeklyPatternStats | null>(null);
  const [aiData,  setAiData]  = useState<AIInsights | null>(null);

  useEffect(() => {
    getWeeklyRadarStats().then(setRadar).catch(() => null);
    getDayOfWeekStats().then(setPattern).catch(() => null);
    getAIInsights().then(setAiData).catch(() => null);
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-4 pt-8 pb-24">
      <div className="mx-auto max-w-sm space-y-4">

        {/* Header */}
        <div className="px-1">
          <h1 className="text-xl font-semibold text-slate-800">Insights</h1>
          <p className="mt-0.5 text-sm text-slate-500">Your emotional patterns</p>
        </div>

        {/* Weekly Mood Radar */}
        {!radar ? (
          <RadarSkeleton />
        ) : (
          <WeeklyMoodRadar radar={radar} />
        )}

        {/* AI Counselor card */}
        {!aiData ? (
          <AISkeleton />
        ) : (
          <AIInsightsCard ai={aiData} />
        )}

        {/* Weekly Pattern card */}
        {!pattern ? (
          <PatternSkeleton />
        ) : !pattern.hasData ? (
          <PatternEmpty />
        ) : (
          <WeeklyPatternCard pattern={pattern} />
        )}

      </div>

      <AppNav />
    </main>
  );
}

// ── Weekly Mood Radar ─────────────────────────────────────────

function RadarSkeleton() {
  return (
    <div className="animate-pulse rounded-3xl bg-white p-6 shadow-sm space-y-4" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <div className="h-4 w-36 rounded-full bg-slate-100" />
          <div className="h-3 w-24 rounded-full bg-slate-100" />
        </div>
        <div className="h-6 w-16 rounded-2xl bg-slate-100" />
      </div>
      <div className="flex items-end gap-1.5 pt-2" style={{ height: "96px" }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-xl bg-slate-100"
            style={{ height: `${30 + i * 8}%` }}
          />
        ))}
      </div>
      <div className="h-10 w-full rounded-2xl bg-slate-100" />
    </div>
  );
}

function WeeklyMoodRadar({ radar }: { radar: WeeklyRadarStats }) {
  const todayIdx  = radar.days.findIndex((d) => d.isToday);
  const [selIdx, setSelIdx] = useState(todayIdx >= 0 ? todayIdx : 0);
  const selected: WeekDayData = radar.days[selIdx];

  // Bar column height in px
  const BAR_AREA_H = 80; // px — the inner bar column container

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm">

      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold text-slate-800">Weekly Mood Radar</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {fmtDateRange(radar.weekStart, radar.weekEnd)}
          </p>
        </div>
        <span className="rounded-2xl bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-600">
          This week
        </span>
      </div>

      {/* ── 7-bar equaliser ────────────────────────────── */}
      <div
        className="mt-5 flex items-end gap-1.5"
        style={{ height: `${BAR_AREA_H + 20}px` }}
        role="list"
        aria-label="Daily mood bars"
      >
        {radar.days.map((day, i) => {
          const isSelected = i === selIdx;
          const isOutlier  = i === radar.outlierIdx;
          const barH = day.avgScore !== null
            ? Math.max((day.avgScore / 5) * BAR_AREA_H, 6)
            : 0;

          return (
            <button
              key={day.day}
              type="button"
              role="listitem"
              onClick={() => setSelIdx(i)}
              aria-label={`${day.day}${day.avgScore !== null ? `: avg ${day.avgScore.toFixed(1)}` : day.isFuture ? ": future" : ": no data"}`}
              aria-pressed={isSelected}
              className="group flex flex-1 flex-col items-center gap-1 focus:outline-none"
            >
              {/* Bar column */}
              <div
                className="relative flex w-full items-end justify-center"
                style={{ height: `${BAR_AREA_H}px` }}
              >
                {day.isFuture ? (
                  /* Future day — dashed placeholder */
                  <div
                    className="w-full rounded-t-xl border-2 border-dashed border-slate-200"
                    style={{ height: "14px" }}
                  />
                ) : day.avgScore === null ? (
                  /* Past, no logs */
                  <div
                    className="w-full rounded-t-xl bg-slate-100"
                    style={{ height: "4px" }}
                  />
                ) : (
                  /* Has data */
                  <div
                    className={[
                      "w-full rounded-t-xl transition-all duration-500",
                      scoreBarColor(day.avgScore),
                      isOutlier  ? "shadow-md ring-2 ring-rose-300 ring-offset-1"  : "",
                      isSelected ? "brightness-110 ring-2 ring-sky-400 ring-offset-1" : "",
                    ].join(" ")}
                    style={{ height: `${barH}px` }}
                  />
                )}
              </div>

              {/* Day label */}
              <span
                className={`text-[10px] font-medium transition-colors ${
                  day.isToday
                    ? "text-sky-500"
                    : isSelected
                    ? "text-slate-700"
                    : "text-slate-400 group-hover:text-slate-500"
                }`}
              >
                {day.day}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Empty-week nudge ───────────────────────────── */}
      {!radar.hasData && (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center">
          <p className="text-sm font-medium text-slate-600">No logs this week yet</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Head to the Log tab and record your first mood —{" "}
            your chart will come alive instantly.
          </p>
        </div>
      )}

      {/* ── Insight text ───────────────────────────────── */}
      {radar.insightText && (
        <div className="mt-4 rounded-2xl bg-sky-50 px-3.5 py-2.5 text-sm text-sky-700">
          {radar.insightText}
        </div>
      )}

      {/* ── Selected day detail panel ──────────────────── */}
      <div className="mt-3 rounded-2xl bg-slate-50 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-slate-700">
            {selected.day} · {fmtShortDate(selected.date)}
          </span>
          {selected.avgScore !== null && (
            <span className="text-xs font-medium text-slate-400">
              avg {selected.avgScore.toFixed(1)} / 5
            </span>
          )}
        </div>

        {selected.isFuture ? (
          <p className="mt-1.5 text-xs text-slate-400">Not yet — check back later.</p>
        ) : selected.total === 0 ? (
          <p className="mt-1.5 text-xs text-slate-400">No logs for this day.</p>
        ) : (
          <div className="mt-2.5 space-y-1.5">
            {MOOD_DISPLAY_ORDER.filter((m) => selected.counts[m] > 0).map((m) => {
              const { Icon, iconColor, barColor } = MOOD_CONFIG[m];
              return (
                <div key={m} className="flex items-center gap-2">
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} aria-hidden="true" />
                  <span className="w-[4.5rem] shrink-0 text-xs text-slate-600">{m}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                      style={{ width: `${(selected.counts[m] / selected.total) * 100}%` }}
                    />
                  </div>
                  <span className="w-5 shrink-0 text-right text-xs text-slate-400">
                    {selected.counts[m]}×
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

// ── Weekly Pattern sub-components ─────────────────────────────

function PatternSkeleton() {
  return (
    <div className="animate-pulse rounded-3xl bg-white p-6 shadow-sm space-y-4" aria-hidden="true">
      <div className="space-y-1.5">
        <div className="h-4 w-36 rounded-full bg-slate-100" />
        <div className="h-3 w-52 rounded-full bg-slate-100" />
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 w-6 rounded-full bg-slate-100" />
            <div className="h-2 flex-1 rounded-full bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PatternEmpty() {
  return (
    <div className="rounded-3xl bg-white p-8 shadow-sm text-center">
      <p className="text-4xl" aria-hidden="true">📅</p>
      <p className="mt-3 font-medium text-slate-700">Not enough data yet</p>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
        Log a few more days to unlock weekly patterns.
      </p>
    </div>
  );
}

const FULL_WEEKDAY: Record<string, string> = {
  Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays",
  Thu: "Thursdays", Fri: "Fridays", Sat: "Saturdays", Sun: "Sundays",
};

function WeeklyPatternCard({ pattern }: { pattern: WeeklyPatternStats }) {
  const { patterns, bestDay, hardestDay } = pattern;

  let insightText: string | null = null;
  if (bestDay)     insightText = `💡 You tend to feel best on ${FULL_WEEKDAY[bestDay]}.`;
  else if (hardestDay) insightText = `💡 ${FULL_WEEKDAY[hardestDay]} tend to be more challenging.`;

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm">

      <div>
        <h2 className="font-semibold text-slate-800">Weekly Pattern</h2>
        <p className="mt-0.5 text-xs text-slate-400">Last 30 days · by day of week</p>
      </div>

      {insightText && (
        <div className="mt-3 rounded-2xl bg-sky-50 px-3.5 py-2.5 text-sm text-sky-700">
          {insightText}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {patterns.map((p) => (
          <div key={p.day} className="flex items-center gap-3">
            <span className="w-7 shrink-0 text-xs font-medium text-slate-500">{p.day}</span>
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
              role="img"
              aria-label={`${p.day}: ${p.total} logs`}
            >
              {p.total > 0 && (
                <div className="flex h-full w-full">
                  {(
                    [
                      ["Great",     "bg-sky-400"    ],
                      ["Good",      "bg-emerald-400"],
                      ["Okay",      "bg-slate-300"  ],
                      ["Not Great", "bg-amber-400"  ],
                      ["Very Low",  "bg-rose-400"   ],
                    ] as [MoodLabel, string][]
                  )
                    .filter(([mood]) => p.counts[mood] > 0)
                    .map(([mood, color]) => (
                      <div
                        key={mood}
                        className={`h-full ${color} transition-all duration-500`}
                        style={{ flex: p.counts[mood] }}
                        title={`${mood}: ${p.counts[mood]}`}
                      />
                    ))}
                </div>
              )}
            </div>
            <span className="w-5 shrink-0 text-right text-xs text-slate-400">
              {p.total > 0 ? p.total : "–"}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5">
        {(
          [
            ["Great",     "bg-sky-400"    ],
            ["Good",      "bg-emerald-400"],
            ["Okay",      "bg-slate-300"  ],
            ["Not Great", "bg-amber-400"  ],
            ["Very Low",  "bg-rose-400"   ],
          ] as [string, string][]
        ).map(([label, color]) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
            <span className="text-[10px] text-slate-400">{label}</span>
          </div>
        ))}
      </div>

    </div>
  );
}

// ── AI Counselor card ─────────────────────────────────────────

function AISkeleton() {
  return (
    <div className="animate-pulse rounded-3xl bg-white p-6 shadow-sm space-y-4" aria-hidden="true">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded-full bg-slate-100" />
        <div className="h-4 w-28 rounded-full bg-slate-100" />
      </div>
      <div className="h-12 w-full rounded-2xl bg-slate-100" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-6 w-16 rounded-full bg-slate-100" />
        ))}
      </div>
      <div className="h-10 w-full rounded-2xl bg-slate-100" />
    </div>
  );
}

function AIInsightsCard({ ai }: { ai: AIInsights }) {
  const hasForecast   = ai.forecast !== null;
  const hasKeywords   = ai.keywords.length > 0;
  const hasResilience = ai.resilience !== null;
  const hasAnyData    = hasForecast || hasKeywords || hasResilience || ai.isLearning;

  if (!hasAnyData) return null;

  const positive = ai.keywords.filter((k: KeywordTag) => k.sentiment === 'positive');
  const negative = ai.keywords.filter((k: KeywordTag) => k.sentiment === 'negative');

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm space-y-5">

      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-lg" aria-hidden="true">✨</span>
        <div>
          <h2 className="font-semibold text-slate-800">AI Counselor</h2>
          <p className="text-xs text-slate-400">Powered by your 30-day history</p>
        </div>
      </div>

      {/* ── 1. Tomorrow Forecast ───────────────────────── */}
      {hasForecast && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Tomorrow&apos;s Forecast
          </p>
          <div
            className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              ai.forecast!.hasConcern
                ? "bg-amber-50 text-amber-800"
                : "bg-sky-50 text-sky-700"
            }`}
          >
            {ai.forecast!.message}
          </div>
        </div>
      )}

      {/* ── 2. Keyword Tag Cloud ────────────────────────── */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          What drives moods?
        </p>

        {ai.isLearning ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center">
            <p className="text-xs leading-relaxed text-slate-500">
              🔍 I&apos;m still learning. Keep adding notes to your logs to unlock
              deeper keyword insights.
              <span className="block mt-1 text-slate-400">
                ({ai.notesWithTextCount}/10 notes collected)
              </span>
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {positive.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-medium text-emerald-600">
                  ✅ Feels better with
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {positive.map((k: KeywordTag) => (
                    <span
                      key={k.word}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium capitalize text-emerald-700"
                    >
                      {k.word}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {negative.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-medium text-rose-500">
                  ❌ Finds challenging
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {negative.map((k: KeywordTag) => (
                    <span
                      key={k.word}
                      className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium capitalize text-rose-600"
                    >
                      {k.word}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!positive.length && !negative.length && (
              <p className="text-xs text-slate-400">
                No strong keyword signals yet — keep adding descriptive notes.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── 3. Biometric Correlation ────────────────────── */}
      {ai.biometricCorrelation && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Body &amp; Mood Link
          </p>
          <div className="rounded-2xl bg-violet-50 px-4 py-3 text-sm leading-relaxed text-violet-800">
            {ai.biometricCorrelation}
          </div>
        </div>
      )}

      {/* ── 4. Resilience Score ─────────────────────────── */}
      {hasResilience && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Resilience Score
          </p>
          <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-800">
            {ai.resilience!.message}
          </div>
          {ai.resilience!.improvementPct !== null && (
            <div className="mt-2.5 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    ai.resilience!.improvementPct > 0
                      ? "bg-emerald-400"
                      : "bg-rose-400"
                  }`}
                  style={{
                    width: `${Math.min(Math.abs(ai.resilience!.improvementPct), 100)}%`,
                  }}
                />
              </div>
              <span className="shrink-0 text-xs font-medium text-slate-500">
                {ai.resilience!.improvementPct > 0 ? "+" : ""}
                {Math.round(ai.resilience!.improvementPct)}%
              </span>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
