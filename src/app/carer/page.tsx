"use client";

/**
 * /carer — Jack 的"上海指挥中心"
 *
 * Layout:
 *   StatusHeader  24h 平安状态（emerald / amber）+ 实时脉冲环
 *   WeatherCard   上海天气 + AI 一句话洞察
 *   Timeline      最近平安信号记录（Realtime 实时更新）
 *
 * Realtime:
 *   supabase.channel('carer-dashboard') → INSERT on checkins
 *   新信号到达 → 脉冲动画 → 无刷新更新时间线顶部
 */

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase";
import type { CheckinRow } from "@/components/senior/carer/CheckinTimeline";
import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import type { WeatherPayload } from "@/app/api/weather/route";
import ComposeMessage from "@/components/senior/carer/ComposeMessage";
import FamilyTimeline from "@/components/senior/carer/FamilyTimeline";
import type { MessageRow } from "@/types/messages";
import { buildFeed } from "@/types/messages";
import type { FeedItem } from "@/types/messages";

// ── Helpers ───────────────────────────────────────────────────

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

function isWithin24h(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < TWENTY_FOUR_HOURS;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min  = Math.floor(diff / 60_000);
  if (min < 1)  return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h} 小时前`;
  return "超过 24 小时前";
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** Rule-based one-line weather insight in Chinese */
function generateInsight(w: WeatherPayload): string {
  if (w.pressure < 1005)
    return `上海气压突降（${w.pressure} hPa），可能引起关节不适，建议提醒妈妈注意保暖休息。`;
  if (w.pressure < 1010)
    return `上海气压偏低，适合轻度活动。天气${w.text}，${w.temp_c}°C，出门记得加件外套。`;
  if (w.temp_c >= 28)
    return `上海气温较高（${w.temp_c}°C），提醒妈妈多补水、避免午后高温时段外出。`;
  if (w.temp_c <= 10)
    return `上海天气偏凉（${w.temp_c}°C），提醒妈妈出门前多加衣物、注意保暖。`;
  return `上海今日${w.text}，气温 ${w.temp_c}°C，气压平稳（${w.pressure} hPa），天气条件良好，适合外出散步。`;
}

// ── Status derivation ─────────────────────────────────────────

type StatusKind = 'safe' | 'idle' | 'wechat' | 'call' | 'voice';

interface StatusInfo {
  kind:        StatusKind;
  label:       string;
  icon:        string;
  subtext:     string;
  itemId:      string | null;
  dismissible: boolean;
}

const STATUS_STYLE: Record<StatusKind, { bg: string; text: string; dot: string; ring: string }> = {
  safe:   { bg: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-100', ring: 'border-emerald-400' },
  idle:   { bg: 'bg-amber-50 border-amber-100',     text: 'text-amber-700',   dot: 'bg-amber-100',   ring: 'border-amber-400'   },
  wechat: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-100', ring: 'border-emerald-400' },
  call:   { bg: 'bg-amber-50 border-amber-200',     text: 'text-amber-700',   dot: 'bg-amber-100',   ring: 'border-amber-400'   },
  voice:  { bg: 'bg-purple-50 border-purple-100',   text: 'text-purple-700',  dot: 'bg-purple-100',  ring: 'border-purple-400'  },
};

const ACTION_KINDS = new Set(['checkin', 'wechat_request', 'call_request', 'voice']);

function deriveStatus(feed: FeedItem[], dismissedId: string | null): StatusInfo {
  const latest     = feed.find((item) => ACTION_KINDS.has(item.kind)) ?? null;
  const lastCheckin = feed.find((i) => i.kind === 'checkin') ?? null;
  const baseGood   = lastCheckin !== null && isWithin24h(lastCheckin.created_at);
  const baseSubtext = lastCheckin
    ? `最后平安信号：${relativeTime(lastCheckin.created_at)}`
    : '还没有收到平安信号';

  // Baseline: no action, dismissed, or the latest is just a checkin
  if (!latest || latest.id === dismissedId || latest.kind === 'checkin') {
    return {
      kind:        baseGood ? 'safe' : 'idle',
      label:       baseGood ? '一切安好' : '建议问候',
      icon:        baseGood ? '❤️' : '🔔',
      subtext:     baseSubtext,
      itemId:      latest?.id ?? null,
      dismissible: false,
    };
  }

  const ago = relativeTime(latest.created_at);

  if (latest.kind === 'wechat_request') return { kind: 'wechat', label: '请求回复微信',   icon: '💬', subtext: `${ago}发来请求`, itemId: latest.id, dismissible: true };
  if (latest.kind === 'call_request')   return { kind: 'call',   label: '请求回个电话',   icon: '📞', subtext: `${ago}发来请求`, itemId: latest.id, dismissible: true };
  if (latest.kind === 'voice')          return { kind: 'voice',  label: '收到新语音留言', icon: '🎙️', subtext: `${ago}发来语音`, itemId: latest.id, dismissible: true };

  return { kind: baseGood ? 'safe' : 'idle', label: baseGood ? '一切安好' : '建议问候', icon: baseGood ? '❤️' : '🔔', subtext: baseSubtext, itemId: null, dismissible: false };
}

// ── StatusHeader ──────────────────────────────────────────────

interface StatusHeaderProps {
  status:     StatusInfo;
  pulse:      boolean;
  onPulseEnd: () => void;
  onDismiss:  () => void;
}

function StatusHeader({ status, pulse, onPulseEnd, onDismiss }: StatusHeaderProps) {
  const style = STATUS_STYLE[status.kind];

  return (
    <div
      className={[
        "relative rounded-3xl px-6 py-7 flex flex-col items-center gap-3 overflow-hidden",
        "transition-all duration-500 ease-out border",
        style.bg,
      ].join(" ")}
    >
      {/* Realtime pulse ring */}
      {pulse && (
        <span
          onAnimationEnd={onPulseEnd}
          className={`absolute inset-0 rounded-3xl border-2 ${style.ring} animate-[ringBurst_0.7s_ease-out_forwards] pointer-events-none`}
        />
      )}

      {/* Status icon */}
      <div className="relative flex items-center justify-center">
        <span className={["w-20 h-20 rounded-full flex items-center justify-center text-4xl", style.dot].join(" ")}>
          {status.icon}
        </span>
        {status.kind === 'safe' && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 ring-2 ring-white animate-pulse" />
        )}
      </div>

      {/* Label */}
      <p className={["text-2xl font-bold tracking-tight", style.text].join(" ")}>
        {status.label}
      </p>

      {/* Subtext */}
      <p className="text-sm text-slate-400">{status.subtext}</p>

      {/* Dismiss — only on actionable statuses */}
      {status.dismissible && (
        <button
          onClick={onDismiss}
          className={[
            "mt-1 text-xs px-4 py-1.5 rounded-full border transition-all active:scale-95",
            style.text,
            "border-current opacity-60 hover:opacity-100",
          ].join(" ")}
        >
          已处理
        </button>
      )}
    </div>
  );
}

// ── WeatherCard ───────────────────────────────────────────────

interface WeatherCardProps {
  weather: WeatherPayload | null;
  loading: boolean;
}

function WeatherCard({ weather, loading }: WeatherCardProps) {
  return (
    <div className="rounded-3xl bg-white border border-slate-100 shadow-sm px-5 py-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🌤</span>
          <p className="text-slate-700 font-semibold text-base">上海实时天气</p>
        </div>
        {weather && (
          <span className="text-sm text-slate-400">
            {weather.temp_c}°C · {weather.text}
          </span>
        )}
      </div>

      {/* Pressure bar */}
      {weather && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 w-10 shrink-0">气压</span>
          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={[
                "h-full rounded-full transition-all duration-700",
                weather.pressure < 1005
                  ? "bg-amber-400"
                  : weather.pressure < 1010
                  ? "bg-sky-400"
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
      <p className="text-slate-500 text-sm leading-relaxed">
        {loading
          ? "正在获取天气数据…"
          : weather
          ? generateInsight(weather)
          : "天气数据暂时不可用，请稍后再试。"}
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function CarerDashboard() {
  const supabase = useMemo(() => createClient(), []);

  const [seniorId,     setSeniorId]     = useState<string | null>(null);
  const [checkins,     setCheckins]     = useState<CheckinRow[]>([]);
  const [weather,      setWeather]      = useState<WeatherPayload | null>(null);
  const [weatherLoad,  setWeatherLoad]  = useState(true);
  const [pulse,        setPulse]        = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [pageReady,    setPageReady]    = useState(false);
  const [messages,    setMessages]    = useState<MessageRow[]>([]);
  const [feed,        setFeed]        = useState<FeedItem[]>([]);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  // Stable ref so realtime handler closure always has fresh seniorId
  const seniorIdRef = useRef<string | null>(null);

  // ── 1. Load senior + checkins ────────────────────────────────
  const loadData = useCallback(async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) console.error('[carer] auth error:', authError.message);
    if (!user) { setLoading(false); return; }

    // Find the senior this carer watches
    const { data: profiles, error: profilesError } = await supabase
      .from("senior_profiles")
      .select("id")
      .limit(1);

    if (profilesError) {
      console.error('[carer] senior_profiles query failed:', profilesError.message, profilesError.code);
    }

    const id = (profiles?.[0] as { id: string } | undefined)?.id ?? null;
    setSeniorId(id);
    seniorIdRef.current = id;

    if (id) {
      const { data: rows, error: checkinsError } = await supabase
        .from("checkins")
        .select("id, checked_in_at, source")
        .eq("senior_id", id)
        .order("checked_in_at", { ascending: false })
        .limit(20);

      if (checkinsError) {
        console.error('[carer] checkins query failed:', checkinsError.message, checkinsError.code);
      }

      setCheckins((rows as CheckinRow[]) ?? []);

      const { data: msgRows, error: messagesError } = await supabase
        .from("messages")
        .select("*")
        .eq("senior_id", id)
        .order("created_at", { ascending: false })
        .limit(40);

      if (messagesError) {
        console.error("[carer] messages query failed:", messagesError.message);
      }

      setMessages((msgRows as MessageRow[]) ?? []);
    } else {
      console.warn('[carer] no senior_profile found for user', user.id,
        '— run the seed SQL in Supabase Dashboard to create one.');
    }

    setLoading(false);
    setTimeout(() => setPageReady(true), 60);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    setFeed(buildFeed(checkins, messages));
  }, [checkins, messages]);

  // ── 2. Realtime subscription ─────────────────────────────────
  // Set up FIRST so we never miss an event during data load
  useEffect(() => {
    const channel = supabase
      .channel("carer-dashboard")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "checkins" },
        (payload: RealtimePostgresInsertPayload<CheckinRow>) => {
          const incoming = payload.new;
          if (
            seniorIdRef.current &&
            (incoming as CheckinRow & { senior_id?: string }).senior_id !== seniorIdRef.current
          ) return;

          setCheckins((prev) => [
            { ...incoming, isNew: true },
            ...prev.slice(0, 19),
          ]);
          setPulse(true);

          setTimeout(() => {
            setCheckins((prev) =>
              prev.map((c, i) => (i === 0 ? { ...c, isNew: false } : c)),
            );
          }, 500);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: RealtimePostgresInsertPayload<MessageRow>) => {
          const incoming = payload.new;
          if (incoming.senior_id !== seniorIdRef.current) return;
          setMessages((prev) => [incoming, ...prev.slice(0, 39)]);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload: RealtimePostgresUpdatePayload<MessageRow>) => {
          const updated = payload.new;
          if (updated.senior_id !== seniorIdRef.current) return;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
          );
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  // ── 3. Weather (Shanghai) ─────────────────────────────────────
  useEffect(() => {
    fetch("/api/weather?city=shanghai")
      .then((r) => r.json())
      .then((d: WeatherPayload) => {
        if (!d.pressure) return;
        setWeather(d);
      })
      .catch(() => null)
      .finally(() => setWeatherLoad(false));
  }, []);

  // ── Loading ──────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-200 border-t-emerald-500 animate-spin" />
      </main>
    );
  }

  const status = deriveStatus(feed, dismissedId);

  // ── Main ─────────────────────────────────────────────────────

  return (
    <main
      className={[
        "min-h-screen bg-slate-50",
        "transition-opacity duration-500 ease-out",
        pageReady ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <div className="max-w-md mx-auto px-4 pt-12 pb-10 flex flex-col gap-5">

        {/* ── Page header ── */}
        <div className="px-1">
          <p className="text-slate-400 text-sm">{getGreeting()}</p>
          <h1 className="text-slate-800 text-2xl font-semibold mt-0.5">
            上海指挥中心
          </h1>
        </div>

        {/* ── Status header ── */}
        <StatusHeader
          status={status}
          pulse={pulse}
          onPulseEnd={() => setPulse(false)}
          onDismiss={() => setDismissedId(status.itemId)}
        />

        {/* ── Weather + AI insight ── */}
        <WeatherCard weather={weather} loading={weatherLoad} />

        {/* ── Timeline ── */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm px-5 py-5">
          <div className="flex items-center justify-between mb-5">
            <p className="text-slate-700 font-semibold text-base">最近动态</p>
            {/* Live badge */}
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              实时
            </span>
          </div>
          <ComposeMessage seniorId={seniorId} />
          <div className="mt-4">
            <FamilyTimeline items={feed} />
          </div>
        </div>

      </div>
    </main>
  );
}
