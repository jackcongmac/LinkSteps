"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckCircle2, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import MoodCard from "@/components/ui/mood-card";
import MoodTrend from "@/components/ui/mood-trend";
import {
  saveMoodLog,
  getWeeklyLogs,
  getTodayLogs,
  getDailyProgress,
} from "@/lib/mood-log";
import type { DayMood } from "@/lib/mood-log";
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

// ── Page ─────────────────────────────────────────────────────

export default function LogPage() {
  const [children, setChildren] = useState<ChildRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [weeklyData, setWeeklyData] = useState<DayMood[] | null>(null);
  const [loggedToday, setLoggedToday] = useState<Map<string, number>>(
    new Map(),
  );
  const [progress, setProgress] = useState<{
    logged: number;
    total: number;
  } | null>(null);

  const selectedChild = children.find((c) => c.id === selectedId) ?? null;
  const childName = selectedChild?.name ?? "your child";

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
    async (level: MoodLevel, iconName: MoodIconName, note?: string) => {
      if (!selectedId || status === "loading") return;

      setStatus("loading");
      setErrorMsg("");

      try {
        const result = await saveMoodLog({
          childId: selectedId,
          level,
          iconName,
          note,
        });

        if ("error" in result) {
          setStatus("error");
          setErrorMsg(result.error);
        } else {
          setStatus("success");
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
      } catch {
        setStatus("error");
        setErrorMsg(
          "Network error. Please check your connection and try again.",
        );
      }
    },
    [selectedId, status, children],
  );

  return (
    <main
      className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-8"
      aria-label="Daily Mood Log"
    >
      <div className="w-full max-w-sm flex flex-col gap-4">

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

        {/* ── Main card area ────────────────────────────────── */}
        {status === "success" ? (
          <div
            className="rounded-3xl bg-white p-8 shadow-sm flex flex-col items-center gap-4 text-center"
            role="status"
            aria-live="polite"
          >
            <CheckCircle2
              className="h-14 w-14 text-emerald-400"
              aria-hidden="true"
            />
            <p className="text-slate-700 font-medium text-lg">Mood Logged!</p>
            <p className="text-slate-500 text-sm">
              Saved to today&apos;s log for {childName}
            </p>
            <button
              type="button"
              onClick={() => setStatus("idle")}
              className="mt-2 rounded-3xl bg-sky-500 px-8 py-2.5 text-sm font-medium text-white active:scale-95 transition-transform"
            >
              Log Again
            </button>
          </div>
        ) : (
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

                          {/* Top-right dot — active/selected focus indicator */}
                          {isSelected && (
                            <div
                              className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white"
                              aria-hidden="true"
                            />
                          )}

                          {/* Bottom-right checkmark — logged today */}
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

            {/* MoodCard */}
            <div
              className={
                status === "loading"
                  ? "opacity-60 pointer-events-none select-none"
                  : ""
              }
            >
              <MoodCard childName={childName} onSave={handleSave} />
            </div>

            {/* Loading indicator */}
            {status === "loading" && (
              <div
                className="flex items-center justify-center gap-2 text-slate-500 text-sm"
                aria-live="polite"
                aria-busy="true"
              >
                <Loader2
                  className="h-4 w-4 animate-spin text-sky-500"
                  aria-hidden="true"
                />
                <span>Saving...</span>
              </div>
            )}

            {/* Error message */}
            {status === "error" && (
              <p className="text-center text-sm text-red-500" role="alert">
                {errorMsg || "Save failed. Please try again."}
              </p>
            )}
          </>
        )}

        {/* ── Mood Trend ─────────────────────────────────────── */}
        {weeklyData ? (
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
        )}

        {/* ── Daily Progress Bar ────────────────────────────────── */}
        {progress && (
          <ProgressBar logged={progress.logged} total={progress.total} />
        )}

      </div>
    </main>
  );
}
