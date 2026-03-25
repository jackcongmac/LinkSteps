"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Check,
  Sun,
  Smile,
  Cloud,
  CloudRain,
  Zap,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import MoodCard from "@/components/ui/mood-card";
import MoodTrend from "@/components/ui/mood-trend";
import RecentLogs from "@/components/ui/recent-logs";
import AppNav from "@/components/ui/app-nav";
import {
  saveLog,
  getRecentLogs,
  getWeeklyLogs,
  getTodayLogs,
  getDailyProgress,
  getTodayMetadata,
  getAIInsights,
  getProfile,
  calculateChildAge,
} from "@/lib/mood-log";
import type { DayMood, LogEntry, LogMetadata, AIInsights, ForecastInsight } from "@/lib/mood-log";
import { generateDailyForecast } from "@/lib/predictor";
import type { ForecastResult, ThreatLevel } from "@/lib/predictor";
import type { MoodLevel, MoodIconName } from "@/components/ui/mood-picker";

// ── Types ────────────────────────────────────────────────────

interface ChildRecord {
  id: string;
  name: string;
}

type SaveStatus = "idle" | "loading" | "success" | "error";

const AVATAR_COLORS = [
  "bg-sky-400",
  "bg-emerald-400",
  "bg-violet-400",
  "bg-amber-400",
  "bg-rose-400",
] as const;

// ── Progress Bar ─────────────────────────────────────────────

/**
 * h-1.5 rounded progress bar.
 *
 * Animation details (@QA):
 *   • Width uses cubic-bezier(0.34, 1.56, 0.64, 1) — a spring easing that
 *     slightly overshoots the target, creating a natural bounce at each step.
 *   • At 100% the fill colour shifts to emerald-400 (300 ms ease).
 *   • The "All done! ✨" badge uses animate-bounce; its `key` is tied to the
 *     logged count so React remounts it (restarts the animation) every time
 *     the bar transitions to 100%.
 */
function ProgressBar({
  logged,
  total,
}: {
  logged: number;
  total: number;
}) {
  const pct = total > 0 ? (logged / total) * 100 : 0;
  const isComplete = total > 0 && logged >= total;

  return (
    <div className="rounded-3xl bg-white px-5 py-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {logged} / {total} children logged today
        </span>

        {isComplete && (
          /* key restarts animate-bounce every time logged reaches total */
          <span
            key={`complete-${logged}`}
            className="text-xs font-medium text-emerald-500 animate-bounce"
            aria-live="polite"
          >
            All done! ✨
          </span>
        )}
      </div>

      {/* Track */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuenow={logged}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${logged} of ${total} children logged today`}
      >
        {/* Fill — spring easing provides the bounce feel at every update */}
        <div
          className={`h-full rounded-full ${
            isComplete ? "bg-emerald-400" : "bg-sky-400"
          }`}
          style={{
            width: `${pct}%`,
            transition:
              "width 600ms cubic-bezier(0.34,1.56,0.64,1), background-color 300ms ease",
          }}
        />
      </div>
    </div>
  );
}

// ── Quick Log config ─────────────────────────────────────────
//
// Maps the ?quick_mood= URL value to a MoodLevel + visual config.
// Keys must match the stored mood labels exactly (case-sensitive).

type QuickMoodCfg = {
  level: MoodLevel;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  iconColor: string;
  iconBg: string;
  overlayGradient: string;
};

const QUICK_MOOD_CONFIG: Record<string, QuickMoodCfg> = {
  Great:        { level: 5, Icon: Sun,       iconColor: "text-sky-500",     iconBg: "bg-sky-100",     overlayGradient: "from-sky-50"     },
  Good:         { level: 4, Icon: Smile,     iconColor: "text-emerald-500", iconBg: "bg-emerald-100", overlayGradient: "from-emerald-50" },
  Okay:         { level: 3, Icon: Cloud,     iconColor: "text-slate-400",   iconBg: "bg-slate-100",   overlayGradient: "from-slate-50"   },
  "Not Great":  { level: 2, Icon: CloudRain, iconColor: "text-amber-500",   iconBg: "bg-amber-100",   overlayGradient: "from-amber-50"   },
  "Very Low":   { level: 1, Icon: Zap,       iconColor: "text-rose-400",    iconBg: "bg-rose-100",    overlayGradient: "from-rose-50"    },
};

// ── Quick Log overlay ─────────────────────────────────────────

function QuickLogOverlay({ mood }: { mood: string }) {
  const cfg = QUICK_MOOD_CONFIG[mood];
  if (!cfg) return null;
  const { Icon, iconColor, iconBg, overlayGradient } = cfg;

  return (
    <>
      {/* Keyframes injected once — no extra CSS file needed */}
      <style>{`
        @keyframes ql-enter {
          from { opacity: 0; transform: translateY(16px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        @keyframes ql-countdown {
          from { width: 100%; }
          to   { width: 0%;   }
        }
      `}</style>

      <div
        className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b ${overlayGradient} to-white px-8 text-center`}
        style={{ animation: "ql-enter 0.45s cubic-bezier(0.34,1.56,0.64,1) both" }}
        role="status"
        aria-live="assertive"
        aria-label={`Quick log saved: feeling ${mood} today`}
      >
        {/* Mood icon */}
        <div
          className={`mb-6 flex h-24 w-24 items-center justify-center rounded-full ${iconBg}`}
        >
          <Icon className={`h-12 w-12 ${iconColor}`} aria-hidden />
        </div>

        {/* Headline */}
        <p className="text-2xl font-semibold text-slate-800">
          Logged instantly!
        </p>

        {/* Sub-line */}
        <p className="mt-2 text-base text-slate-500">
          Feeling{" "}
          <span className="font-semibold text-slate-700">{mood}</span> today.
        </p>

        {/* Countdown bar — 2 s matches the setTimeout dismiss */}
        <div className="mt-10 h-1 w-20 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-slate-400"
            style={{ animation: "ql-countdown 2s linear forwards" }}
          />
        </div>
      </div>
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────

function LogPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [children, setChildren] = useState<ChildRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);
  // Incremented on each successful save to remount MoodCard (clears its state)
  const [moodCardKey, setMoodCardKey] = useState(0);
  // Ref-based in-flight guard — avoids stale-closure issues with status in useCallback deps
  const isSavingRef = useRef(false);
  // Quick Log — ref guards against StrictMode double-fire
  const quickLogFiredRef = useRef(false);
  const [quickLogMood, setQuickLogMood] = useState<string | null>(null);
  const [recentLogs, setRecentLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [todayMetadata, setTodayMetadata] = useState<LogMetadata | null>(null);
  const [aiData, setAiData] = useState<AIInsights | null>(null);
  // Child name & birthday from user's profile — refreshes instantly after Settings save
  const [profileChildName, setProfileChildName] = useState<string | null>(null);
  const [profileChildBirthday, setProfileChildBirthday] = useState<string | undefined>(undefined);
  const [weeklyData, setWeeklyData] = useState<DayMood[] | null>(null);
  const [loggedToday, setLoggedToday] = useState<Map<string, number>>(
    new Map(),
  );
  const [progress, setProgress] = useState<{
    logged: number;
    total: number;
  } | null>(null);

  const selectedChild = children.find((c) => c.id === selectedId) ?? null;
  // Display name: Settings profile > children table > generic fallback
  const displayChildName: string | null =
    profileChildName || selectedChild?.name || null;
  const childName = displayChildName ?? "your child";
  // Age computed directly from profile birthday — reactive to Settings changes,
  // no dependency on getAIInsights(). calculateChildAge returns (CurrentYear - BirthYear)
  // adjusted for whether the birthday has passed this year.
  const childAge: number | undefined = calculateChildAge(profileChildBirthday);

  // ── Load children on mount ────────────────────────────────
  useEffect(() => {
    async function fetchChildren() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("children")
        .select("id, name")
        .eq("parent_id", user.id)
        .order("created_at");

      if (data && data.length > 0) {
        const records = data as ChildRecord[];
        setChildren(records);
        setSelectedId(records[0].id);

        const ids = records.map((c) => c.id);
        // Fetch today status + progress in parallel
        Promise.all([getTodayLogs(ids), getDailyProgress(ids)])
          .then(([today, prog]) => {
            setLoggedToday(today);
            setProgress(prog);
          })
          .catch(() => null);
      }
    }

    void fetchChildren();
  }, []);

  // ── Recent logs ───────────────────────────────────────────
  const refreshLogs = useCallback(async () => {
    const entries = await getRecentLogs(10);
    setRecentLogs(entries);
    setLogsLoading(false);
  }, []);

  useEffect(() => {
    void refreshLogs();
    getTodayMetadata().then(setTodayMetadata).catch(() => null);
    getAIInsights().then(setAiData).catch(() => null);
  }, [refreshLogs]);

  // Load child name + birthday from profile; re-read whenever Settings saves (custom event)
  useEffect(() => {
    function loadProfile() {
      getProfile()
        .then((p) => {
          setProfileChildName(p.child_name || null);
          setProfileChildBirthday(p.child_birthday || undefined);
        })
        .catch(() => null);
    }
    loadProfile();
    window.addEventListener('linksteps:profile_updated', loadProfile);
    return () => window.removeEventListener('linksteps:profile_updated', loadProfile);
  }, []);

  // ── One-Tap Quick Log ─────────────────────────────────────
  // Reads ?quick_mood=Good from the URL, auto-saves, shows overlay.
  // URL is cleaned immediately so a page refresh won't re-submit.
  useEffect(() => {
    if (quickLogFiredRef.current) return;

    const rawMood = searchParams.get("quick_mood");
    if (!rawMood) return;

    const cfg = QUICK_MOOD_CONFIG[rawMood];
    if (!cfg) return;

    quickLogFiredRef.current = true;

    // 1. Scrub params from URL — replace (not push) so back-button is clean
    router.replace("/log");

    // 2. Save silently in the background
    void saveLog({ level: cfg.level, note: "Quick Log" }).then((result) => {
      if ("id" in result) {
        setQuickLogMood(rawMood);
        void refreshLogs();
        setTimeout(() => setQuickLogMood(null), 2000);
      }
    });
  }, [searchParams, router, refreshLogs]);

  // ── Refetch weekly trend on child change ──────────────────
  useEffect(() => {
    if (!selectedId) return;
    setWeeklyData(null);
    getWeeklyLogs(selectedId).then(setWeeklyData).catch(() => null);
  }, [selectedId]);

  // ── Switch student ────────────────────────────────────────
  function handleSelectChild(id: string) {
    if (id === selectedId) return;
    setSelectedId(id);
    setStatus("idle");
    setErrorMsg("");
  }

  // ── Save mood ─────────────────────────────────────────────
  const handleSave = useCallback(
    async (level: MoodLevel, _iconName: MoodIconName, note?: string) => {
      // Use ref guard instead of reading `status` from closure — prevents
      // double-submit and ensures setStatus("loading") always fires.
      if (isSavingRef.current) return;
      isSavingRef.current = true;

      setStatus("loading");
      setErrorMsg("");

      try {
        const result = await saveLog({ level, note });

        if ("error" in result) {
          setStatus("error");
          setErrorMsg(result.error);
        } else {
          setStatus("idle");
          // Remount MoodCard to clear selected mood + note
          setMoodCardKey((k) => k + 1);
          // Show inline "Saved!" toast, auto-dismiss after 2.5 s
          setToast("Saved!");
          setTimeout(() => setToast(null), 2500);

          // Refresh recent logs list
          void refreshLogs();

          // Refresh trend / progress in the background (non-critical)
          if (selectedId) {
            const ids = children.map((c) => c.id);
            Promise.all([
              getWeeklyLogs(selectedId),
              getTodayLogs(ids),
              getDailyProgress(ids),
            ])
              .then(([weekly, today, prog]) => {
                setWeeklyData(weekly);
                setLoggedToday(today);
                setProgress(prog);
              })
              .catch(() => null);
          }
        }
      } catch {
        setStatus("error");
        setErrorMsg("Network error. Please check your connection and try again.");
      } finally {
        isSavingRef.current = false;
      }
    },
    [selectedId, children, refreshLogs],
  );

  return (
    <main
      className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-8 pb-24"
      aria-label="Daily Mood Log"
    >
      <div className="w-full max-w-sm flex flex-col gap-4">

        {/* ── Page header ───────────────────────────────────── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-base font-semibold text-slate-700">Daily Log</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              How is {displayChildName || "Ethan"} feeling today?
            </p>
          </div>
          <Link
            href="/settings"
            aria-label="Settings"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white shadow-sm active:scale-95 transition-transform hover:bg-slate-50"
          >
            <Settings className="h-4 w-4 text-slate-500" aria-hidden="true" />
          </Link>
        </div>

        {/* ── Mission Control — Today's Outlook (top of page) ── */}
        {/* Toggle SHOW_DEMO = true to re-enable the triple-threat demo card */}
        {(todayMetadata || SHOW_DEMO) && (
          <OutlookCard
            metadata={todayMetadata ?? DEMO_METADATA}
            childName={displayChildName ?? (SHOW_DEMO ? "Ethan" : undefined)}
            viewMode={new Date().getHours() < 12 ? "AM" : "PM"}
          />
        )}

        {/* ── Tomorrow's Forecast — set SHOW_TOMORROW_FORECAST = false to hide */}
        {SHOW_TOMORROW_FORECAST && aiData?.forecast && (
          <TomorrowForecastCard forecast={aiData.forecast} />
        )}

        {/* ── Quick Summary bar ──────────────────────────────── */}
        {children.length > 0 && progress && (
          <div
            className="rounded-3xl bg-white px-5 py-3 shadow-sm flex items-center justify-between"
            aria-live="polite"
            aria-label="Today's logging progress"
          >
            <span className="text-sm font-medium text-slate-700">
              {progress.logged}/{progress.total} Student
              {progress.total !== 1 ? "s" : ""} Logged
            </span>
            {progress.logged > 0 && progress.logged < progress.total && (
              <span className="text-xs text-slate-400">
                {progress.total - progress.logged} remaining
              </span>
            )}
            {progress.logged === progress.total && progress.total > 0 && (
              <span className="text-xs font-medium text-emerald-500">
                All done!
              </span>
            )}
          </div>
        )}

        {/* ── Toast ────────────────────────────────────────── */}
        {toast && (
          <div
            className="flex items-center justify-center gap-2 rounded-3xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-600"
            role="status"
            aria-live="polite"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {toast}
          </div>
        )}

        {/* ── Main card area ────────────────────────────────── */}
        <>
          {/* Student Switcher */}
          {children.length > 0 && (
            <div
              className="overflow-x-auto"
              role="group"
              aria-label="Select student"
            >
              <div className="flex gap-4 pb-2 min-w-max px-1">
                {children.map((child, i) => {
                  const isSelected = selectedId === child.id;
                  const isLogged = loggedToday.has(child.id);
                  const colorClass = AVATAR_COLORS[i % AVATAR_COLORS.length];
                  return (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => handleSelectChild(child.id)}
                      aria-pressed={isSelected}
                      aria-label={`Switch to ${child.name}${isLogged ? " — logged today" : ""}`}
                      className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform"
                    >
                      <div className="relative">
                        <div
                          className={`h-12 w-12 rounded-full flex items-center justify-center text-white font-semibold text-lg transition-all ${colorClass} ${
                            isSelected
                              ? "ring-2 ring-sky-400 ring-offset-2"
                              : "opacity-40"
                          }`}
                        >
                          {child.name.charAt(0).toUpperCase()}
                        </div>

                        {isSelected && (
                          <div
                            className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white"
                            aria-hidden="true"
                          />
                        )}

                        {isLogged && (
                          <div
                            className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-emerald-400 flex items-center justify-center ring-2 ring-white"
                            aria-hidden="true"
                          >
                            <Check
                              className="h-3 w-3 text-white"
                              strokeWidth={3}
                            />
                          </div>
                        )}
                      </div>

                      <span
                        className={`text-xs font-medium transition-colors ${
                          isSelected ? "text-sky-600" : "text-slate-400"
                        }`}
                      >
                        {child.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Daily Slogan — always visible above the input card ── */}
          <DailySloganCard ageYears={childAge} />

          {/* key changes on each successful save — remounts MoodCard, clearing
              selected mood + note without any prop drilling */}
          <MoodCard
            key={moodCardKey}
            childName={childName}
            saving={status === "loading"}
            onSave={handleSave}
          />

          {/* Error message */}
          {status === "error" && (
            <p className="text-center text-sm text-red-500" role="alert">
              {errorMsg || "Save failed. Please try again."}
            </p>
          )}
        </>

        {/* ── Mood Trend — only rendered when a child is selected ── */}
        {selectedId && (
          weeklyData ? (
            <MoodTrend data={weeklyData} />
          ) : (
            <div
              className="rounded-3xl bg-white p-5 shadow-sm"
              aria-hidden="true"
            >
              <div className="mb-4 h-4 w-24 rounded-full bg-slate-100 animate-pulse" />
              <div className="flex justify-between gap-1">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-slate-100 animate-pulse" />
                    <div className="h-2 w-4 rounded-full bg-slate-100 animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          )
        )}

        {/* ── Daily Progress Bar ────────────────────────────────── */}
        {progress && (
          <ProgressBar logged={progress.logged} total={progress.total} />
        )}

        {/* ── Welcome nudge — shown only before the very first log ── */}
        {!logsLoading && recentLogs.length === 0 && (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-6 text-center shadow-sm">
            <p className="text-2xl" aria-hidden="true">🌱</p>
            <p className="mt-2.5 text-sm font-semibold text-slate-700">
              How are you feeling today?
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Tap a mood above to log your first check-in.
              <br />
              Your weekly chart will appear after a few logs.
            </p>
          </div>
        )}

        {/* ── Daily Log timeline ───────────────────────────────── */}
        {/* When SHOW_DEMO = true and there are no real logs, show mock caregiver entries */}
        {(recentLogs.length > 0 || (SHOW_DEMO && !logsLoading)) && (
          <div className="rounded-3xl bg-white px-5 pt-5 pb-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-slate-700">Daily Log</h2>
            <RecentLogs
              entries={recentLogs.length > 0 ? recentLogs : DEMO_LOGS}
              loading={logsLoading}
            />
          </div>
        )}

      </div>

      <AppNav />

      {/* One-Tap Quick Log overlay — fixed, z-50, auto-dismissed after 2 s */}
      {quickLogMood && <QuickLogOverlay mood={quickLogMood} />}
    </main>
  );
}

// ── Mission Control — Today's Outlook card ────────────────────

/**
 * Set to `true` to re-enable the triple-threat demo card at the top of the
 * Log page. Keep `false` in production so the page loads clean.
 */
const SHOW_DEMO = false;

/**
 * Set to `false` to hide Tomorrow's Forecast on the Log tab.
 * Currently `true` so Jack can confirm placement.
 */
const SHOW_TOMORROW_FORECAST = true;

/** Triple-threat demo metadata — rendered when no real biometric data exists for today. */
const DEMO_METADATA: LogMetadata = {
  steps: 16_500,
  sleep_hours: 5.2,
  pollen_level: 9,
  heart_rate_variability: 18,
  pressure: 993,   // low barometric pressure — adds to the compound scenario
};

/**
 * Demo log entries — two caregivers' perspectives.
 * Injected into the Daily Log section when SHOW_DEMO = true.
 */
const DEMO_LOGS: LogEntry[] = [
  {
    id: "demo-teacher-1",
    mood: "Great",
    note: "Ethan followed instructions well during art class.",
    created_at: new Date(Date.now() - 1 * 3_600_000).toISOString(),
    author_name: "Teacher",
    author_role: "teacher",
  },
  {
    id: "demo-parent-1",
    mood: "Great",
    note: "Ethan slept 8h. Morning mood is Great.",
    created_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    author_name: "Jack",
    author_role: "parent",
  },
];

// ── Daily Slogan card ─────────────────────────────────────────────
//
// Shows a curated spectrum-informed slogan above the MoodCard every day.
// Text is age-aware: "6-year-olds" when we know the age, "young children" as fallback.

function DailySloganCard({ ageYears }: { ageYears?: number }) {
  const ageLabel = ageYears !== undefined ? `${ageYears}-year-olds` : "young children";
  return (
    <div className="rounded-2xl border-l-4 border-l-sky-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
        Today&apos;s Reminder
      </p>
      <p className="text-sm text-slate-600 leading-snug">
        Structured routines help {ageLabel} manage transitions.
      </p>
    </div>
  );
}

// ── Tomorrow's Forecast card (Log page — action-focused) ─────────

function TomorrowForecastCard({ forecast }: { forecast: ForecastInsight }) {
  const { hasConcern, tomorrowDay, message } = forecast;

  return (
    <div
      className={`rounded-2xl border-l-4 bg-white backdrop-blur-md px-4 py-3.5 shadow-sm ${
        hasConcern ? "border-l-amber-300" : "border-l-slate-200"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        🔮 Tomorrow&apos;s Outlook · {tomorrowDay}
      </p>
      <p
        className={`mt-1.5 text-sm leading-snug ${
          hasConcern ? "font-medium text-amber-800" : "text-slate-500"
        }`}
      >
        {message}
      </p>
    </div>
  );
}

// Calm, de-cluttered threat styles — white card, left border accent only
const THREAT_STYLE: Record<
  ThreatLevel,
  { leftBorder: string; header: string; pill: string }
> = {
  normal:   { leftBorder: "border-l-slate-200",  header: "text-slate-700", pill: "bg-slate-100 text-slate-500" },
  elevated: { leftBorder: "border-l-amber-300",  header: "text-slate-700", pill: "bg-amber-50  text-amber-700" },
  critical: { leftBorder: "border-l-rose-300",   header: "text-slate-700", pill: "bg-rose-50   text-rose-600"  },
};

const VIEW_MODE_LABEL: Record<'AM' | 'PM', string> = {
  AM: "🌅 Morning Brief",
  PM: "🌇 Afternoon Check-in",
};

function OutlookCard({
  metadata,
  childName,
  viewMode = "AM",
}: {
  metadata: LogMetadata;
  childName?: string;
  viewMode?: "AM" | "PM";
}) {
  const router = useRouter();
  const forecast = generateDailyForecast(metadata, childName);
  const s = THREAT_STYLE[forecast.threatLevel];
  const isDemo = childName !== undefined;

  return (
    <div
      className={`relative rounded-2xl border-l-4 bg-white backdrop-blur-md px-4 py-4 shadow-sm ${s.leftBorder}`}
    >
      {/* Demo badge */}
      {isDemo && (
        <span className="absolute right-3 top-3 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
          Demo
        </span>
      )}

      {/* Header label — changes based on AM/PM view */}
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {VIEW_MODE_LABEL[viewMode]}
      </p>

      {/* Main content row — headline left, metric pills right */}
      <div className="mt-1.5 flex items-start justify-between gap-3">
        {/* Headline */}
        <p className={`flex-1 text-sm font-medium leading-snug ${s.header}`}>
          {forecast.headline}
        </p>

        {/* Icon pills — small, unobtrusive */}
        {forecast.factorMetrics.length > 0 && (
          <div className="flex shrink-0 flex-col gap-1 pt-0.5">
            {forecast.factorMetrics.map((m) => (
              <span
                key={m.label}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${s.pill}`}
                aria-label={`${m.label}: ${m.value}`}
              >
                {m.icon} {m.value}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Spectrum-informed slogan — curated ASD-safe, shown only when signals are elevated */}
      {forecast.slogan && (
        <p className="mt-3 border-t border-slate-100 pt-2.5 text-[11px] leading-relaxed text-slate-500 italic">
          {forecast.slogan}
        </p>
      )}

      {/* Weekly report link */}
      <button
        type="button"
        onClick={() => router.push("/insights")}
        className="mt-3 text-xs font-medium text-slate-400 underline-offset-2 hover:text-slate-600 active:scale-95 transition"
      >
        查看完整周报 →
      </button>
    </div>
  );
}

// useSearchParams requires a Suspense boundary in Next.js App Router
export default function LogPage() {
  return (
    <Suspense>
      <LogPageInner />
    </Suspense>
  );
}
