// src/app/senior-home/page.tsx
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import PeaceButton   from "@/components/senior/senior/PeaceButton";
import VoiceRecorder from "@/components/senior/senior/VoiceRecorder";
import QuickRequest  from "@/components/senior/senior/QuickRequest";
import type { MessageRow } from "@/types/messages";
import { startHealthSimulator } from "@/lib/health-simulator";
import type { WeatherPayload } from "@/app/api/weather/route";

// ── Clock / weather helpers ───────────────────────────────────

function getBjClock(): { time: string; period: string } {
  const bj = new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
  const d  = new Date(bj);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const h  = d.getHours();
  let period = "深夜";
  if (h >=  5 && h <  9) period = "早晨";
  else if (h >=  9 && h < 12) period = "上午";
  else if (h >= 12 && h < 14) period = "中午";
  else if (h >= 14 && h < 18) period = "下午";
  else if (h >= 18 && h < 21) period = "傍晚";
  else if (h >= 21)            period = "晚上";
  return { time: `${hh}:${mm}`, period };
}

function weatherIcon(code: string): string {
  const n = parseInt(code, 10);
  if (n === 100)                return "☀️";
  if (n >= 101 && n <= 103)     return "⛅";
  if (n === 104)                return "☁️";
  if (n >= 200 && n <= 213)     return "💨";
  if (n >= 300 && n <= 313)     return "🌧️";
  if (n >= 314 && n <= 399)     return "🌩️";
  if (n >= 400 && n <= 499)     return "❄️";
  if (n >= 500 && n <= 599)     return "🌫️";
  return "🌤️";
}

function generateInsight(w: WeatherPayload): string {
  if (w.pressure < 1005)
    return `北京气压突降（${w.pressure} hPa），可能引起关节不适，建议注意保暖休息。`;
  if (w.pressure < 1010)
    return `北京气压偏低，适合轻度室内活动。天气${w.text}，出门记得加件外套。`;
  if (w.temp_max >= 28)
    return `北京今日气温偏高，多补水、避免午后高温时段外出。`;
  if (w.temp_min <= 10)
    return `北京今日气温偏凉，出门前多加衣物、注意保暖。`;
  return `北京今日${w.text}，天气条件良好，适合外出散步。`;
}

// ── Timestamp helpers (Beijing timezone) ─────────────────────

function bjDateStr(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function bjDaysAgo(iso: string): number {
  const today    = bjDateStr(new Date().toISOString());
  const itemDate = bjDateStr(iso);
  return Math.round(
    (new Date(today).getTime() - new Date(itemDate).getTime()) / 86_400_000,
  );
}

function bjHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour:     "2-digit",
    minute:   "2-digit",
    hour12:   false,
  });
}

function bjWeekday(iso: string): string {
  const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const bj    = new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  return names[bj.getDay()];
}

function formatMsgTimestamp(iso: string): string {
  const daysAgo = bjDaysAgo(iso);
  const hhmm    = bjHHMM(iso);
  if (daysAgo === 0) {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
    if (mins < 1)  return "刚刚";
    if (mins < 60) return `${mins} 分钟前 · ${hhmm}`;
    return `${Math.floor(mins / 60)} 小时前 · ${hhmm}`;
  }
  if (daysAgo === 1) return `昨天 · ${hhmm}`;
  return `${bjWeekday(iso)} · ${hhmm}`;
}

export default function SeniorHomePage() {
  // ── Stable Supabase instance — never recreate on render ──────
  const supabase = useMemo(() => createClient(), []);

  const [seniorId,     setSeniorId]     = useState<string | null>(null);
  const [latestMsg,    setLatestMsg]    = useState<MessageRow | null>(null);
  const [msgIsNew,     setMsgIsNew]     = useState(false);
  const [msgDismissed, setMsgDismissed] = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [ready,        setReady]        = useState(false);
  const [weather,      setWeather]      = useState<WeatherPayload | null>(null);
  const [clock,        setClock]        = useState(getBjClock);

  // Tick clock every minute
  useEffect(() => {
    const t = setInterval(() => setClock(getBjClock()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Load senior profile + latest carer message ────────────────
  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Use limit(1) — same as carer dashboard — so both devices resolve
    // the same senior_profile row (e.g. 3d778d6b8b09) and share one
    // senior_id for messages + storage paths.
    const { data: profiles } = await supabase
      .from("senior_profiles")
      .select("id")
      .limit(1);

    const id = (profiles?.[0] as { id: string } | undefined)?.id ?? null;
    console.log("[DEBUG] Senior resolved seniorId:", id);
    setSeniorId(id);

    if (id) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("*")
        .eq("senior_id", id)
        .eq("type", "text")
        .eq("sender_role", "carer")
        .order("created_at", { ascending: false })
        .limit(1);

      setLatestMsg((msgs as MessageRow[] | null)?.[0] ?? null);
    }

    // Fetch local city weather
    fetch("/api/weather?city=beijing")
      .then((r) => r.json())
      .then((d) => setWeather(d as WeatherPayload))
      .catch(() => {/* non-critical */});

    setLoading(false);
    setTimeout(() => setReady(true), 60);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Health simulator — starts once seniorId is resolved ──────
  useEffect(() => {
    if (!seniorId) return;
    const stop = startHealthSimulator(supabase, seniorId);
    return stop;
  }, [supabase, seniorId]);

  // ── Realtime: subscribe once seniorId is known ────────────────
  // Broad subscription (no server-side filter) — client-side match.
  // Re-runs whenever seniorId changes (initially null → then real id).
  useEffect(() => {
    if (!seniorId) return;

    let channel = supabase
      .channel("senior-home-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: RealtimePostgresInsertPayload<MessageRow>) => {
          const incoming = payload.new;
          // Only care about carer text messages for THIS senior
          if (
            incoming.senior_id  !== seniorId ||
            incoming.sender_role !== "carer"  ||
            incoming.type        !== "text"
          ) return;

          console.log("[senior-realtime] new carer message:", incoming.id);
          setLatestMsg(incoming);
          setMsgDismissed(false);
          setMsgIsNew(true);
          setTimeout(() => setMsgIsNew(false), 1400);
        },
      )
      .subscribe((status) => {
        console.log("[senior-realtime] channel status:", status);
      });

    // ── Keep-alive for mobile browsers ───────────────────────────
    // Xiaomi / Android Chrome suspends WebSocket when screen dims.
    // On visibilitychange → visible, tear down stale channel and
    // re-subscribe, then re-fetch in case we missed messages.
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      console.log("[senior-realtime] page visible — resubscribing");
      supabase.removeChannel(channel);
      channel = supabase
        .channel("senior-home-messages-revival")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload: RealtimePostgresInsertPayload<MessageRow>) => {
            const incoming = payload.new;
            if (
              incoming.senior_id  !== seniorId ||
              incoming.sender_role !== "carer"  ||
              incoming.type        !== "text"
            ) return;
            console.log("[senior-realtime] new carer message (revival):", incoming.id);
            setLatestMsg(incoming);
            setMsgDismissed(false);
            setMsgIsNew(true);
            setTimeout(() => setMsgIsNew(false), 1400);
          },
        )
        .subscribe((status) => {
          console.log("[senior-realtime] revival channel:", status);
        });

      // Also re-fetch to catch any messages missed while suspended
      supabase
        .from("messages")
        .select("*")
        .eq("senior_id", seniorId)
        .eq("type", "text")
        .eq("sender_role", "carer")
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => {
          const latest = (data as MessageRow[] | null)?.[0] ?? null;
          if (latest) {
            setLatestMsg((prev) =>
              !prev || latest.created_at > prev.created_at ? latest : prev,
            );
          }
        });
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      supabase.removeChannel(channel);
    };
  }, [supabase, seniorId]);

  // ── Mark message as read ──────────────────────────────────────
  const handleMarkRead = useCallback(async (id: string) => {
    setMsgDismissed(true);
    const { error } = await supabase
      .from("messages")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("[senior-home] mark-read failed:", error.message);
    }
    setLatestMsg((prev) => prev ? { ...prev, is_read: true } : prev);
  }, [supabase]);

  // ── Loading ───────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-emerald-200 border-t-emerald-500 animate-spin" />
      </main>
    );
  }

  if (!seniorId) {
    return (
      <main className="min-h-screen bg-stone-50 flex flex-col items-center justify-center gap-4 px-10">
        <p className="text-stone-500 text-xl text-center leading-relaxed">
          请让家人帮您完成初始设置
        </p>
      </main>
    );
  }

  // ── Main ──────────────────────────────────────────────────────
  return (
    <main
      className={[
        "min-h-screen bg-stone-50",
        "flex flex-col items-center justify-center gap-8",
        "transition-opacity duration-500 ease-out px-6",
        ready ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      {/* ── 天气 + 晚辈留言 ── */}
      <div className="w-full max-w-md rounded-3xl bg-white border border-slate-100 shadow-sm px-5 py-5 flex flex-col gap-4">

        {/* EnvTile: clock row */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-slate-800 text-3xl font-bold tabular-nums leading-none">{clock.time}</p>
            <p className="text-slate-400 text-sm mt-1">北京 · {clock.period}</p>
          </div>
          <div className="text-right flex flex-col items-end gap-0.5">
            {!weather ? (
              <div className="w-5 h-5 rounded-full border-2 border-slate-200 border-t-slate-400 animate-spin" />
            ) : (
              <>
                <p className="text-slate-700 font-semibold">
                  {weatherIcon(weather.icon_code)} {weather.temp_c}°C
                </p>
                <p className="text-slate-400 text-xs">
                  {weather.temp_min}–{weather.temp_max}°C · {weather.text}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Pressure bar */}
        {weather && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 w-10 shrink-0">气压</span>
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={[
                  "h-full rounded-full transition-all duration-700",
                  weather.pressure < 1005 ? "bg-amber-400"
                  : weather.pressure < 1010 ? "bg-sky-400"
                  : "bg-emerald-400",
                ].join(" ")}
                style={{ width: `${Math.min(100, ((weather.pressure - 990) / 40) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-slate-500 w-16 text-right shrink-0">
              {weather.pressure} hPa
            </span>
          </div>
        )}

        {/* AI insight */}
        {weather && (
          <p className="text-slate-500 text-sm leading-relaxed">
            {generateInsight(weather)}
          </p>
        )}

        {/* Divider + carer message */}
        {latestMsg && !msgDismissed && (
          <>
            <div className="h-px bg-slate-100" />
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                {latestMsg.sender_name && (
                  <p className="text-xs font-semibold text-slate-400 mb-1">{latestMsg.sender_name}</p>
                )}
                <p className="text-slate-700 text-sm leading-relaxed break-words">
                  💬 {latestMsg.content}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {formatMsgTimestamp(latestMsg.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleMarkRead(latestMsg.id)}
                className="shrink-0 rounded-2xl bg-emerald-50 border border-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-600 active:scale-95 transition-transform"
              >
                已读
              </button>
            </div>
          </>
        )}
      </div>

      <PeaceButton
        seniorId={seniorId}
        carerName="Jack"
      />

      <div className="flex flex-col gap-3 w-full max-w-md">
        <VoiceRecorder seniorId={seniorId} />
        <QuickRequest  seniorId={seniorId} />
      </div>
    </main>
  );
}
