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

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Play, Pause } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { CheckinRow } from "@/components/senior/carer/CheckinTimeline";
import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import type { WeatherPayload } from "@/app/api/weather/route";
import { calculateSeniorWellness } from "@/lib/wellness-score";
import type { WellnessResult } from "@/lib/wellness-score";
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

/** Jack's greeting based on his local time */
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

/** Beijing (Asia/Shanghai) time string + period label */
function getBjClock(): { time: string; period: string } {
  const bj = new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
  const d   = new Date(bj);
  const hh  = String(d.getHours()).padStart(2, "0");
  const mm  = String(d.getMinutes()).padStart(2, "0");
  const h   = d.getHours();
  let period = "深夜";
  if (h >=  5 && h <  9) period = "早晨";
  else if (h >=  9 && h < 12) period = "上午";
  else if (h >= 12 && h < 14) period = "中午";
  else if (h >= 14 && h < 18) period = "下午";
  else if (h >= 18 && h < 21) period = "傍晚";
  else if (h >= 21)            period = "晚上";
  return { time: `${hh}:${mm}`, period };
}

/** Current Beijing hour (0–23) */
function getBjHour(): number {
  const bj = new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
  return new Date(bj).getHours();
}

/** Jack's local time string */
function getLocalClock(): string {
  const d  = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** QWeather icon_code → emoji */
function weatherIcon(code: string): string {
  const n = parseInt(code, 10);
  if (n === 100)                   return "☀️";
  if (n >= 101 && n <= 103)        return "⛅";
  if (n === 104)                   return "☁️";
  if (n >= 200 && n <= 213)        return "💨";
  if (n >= 300 && n <= 313)        return "🌧️";
  if (n >= 314 && n <= 399)        return "🌩️";
  if (n >= 400 && n <= 499)        return "❄️";
  if (n >= 500 && n <= 599)        return "🌫️";
  return "🌤️";
}

/** Rule-based one-line weather insight referencing Beijing */
function generateInsight(w: WeatherPayload): string {
  if (w.pressure < 1005)
    return `北京气压突降（${w.pressure} hPa），可能引起关节不适，建议提醒妈妈注意保暖休息。`;
  if (w.pressure < 1010)
    return `北京气压偏低，适合轻度室内活动。天气${w.text}，出门记得加件外套。`;
  if (w.temp_max >= 28)
    return `北京今日气温偏高，提醒妈妈多补水、避免午后高温时段外出。`;
  if (w.temp_min <= 10)
    return `北京今日气温偏凉，提醒妈妈出门前多加衣物、注意保暖。`;
  return `北京今日${w.text}，天气条件良好，适合外出散步。`;
}

// ── Health types ──────────────────────────────────────────────

interface HealthRow {
  id:          string;
  senior_id:   string;
  metric_type: string;   // 'heart_rate' | 'steps'
  value:       number;
  measured_at: string;
}

interface HealthData {
  heartRate: number;
  steps:     number;
}

type SleepCurrentState = 'awake' | 'deep' | 'light' | 'nap' | 'resting' | null;

interface SleepSession {
  id:            string;
  session_date:  string;
  total_hours:   number | null;
  deep_hours:    number | null;
  light_hours:   number | null;
  rem_hours:     number | null;
  current_state: SleepCurrentState;
}

// ── Status derivation ─────────────────────────────────────────

type StatusKind = 'safe' | 'idle' | 'wechat' | 'call' | 'voice';

// ── Watchdog thresholds ────────────────────────────────────────
// Demo values: 2 / 5 min — easy to test by stopping the simulator.
// Production values: 15 / 60 min.
const DORMANT_MIN = 2;    // minutes — device asleep
const OFFLINE_MIN = 5;    // minutes — connection lost


interface StatusInfo {
  kind:        StatusKind;
  label:       string;
  icon:        string;
  subtext:     string;
  itemId:      string | null;
  dismissible: boolean;
  audioUrl?:   string;   // only set when kind === 'voice'
}

const STATUS_STYLE: Record<StatusKind, { bg: string; text: string; dot: string; ring: string; spin: string }> = {
  safe:   { bg: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-100', ring: 'border-emerald-400', spin: 'border-t-emerald-600' },
  idle:   { bg: 'bg-amber-50 border-amber-100',     text: 'text-amber-700',   dot: 'bg-amber-100',   ring: 'border-amber-400',   spin: 'border-t-amber-600'   },
  wechat: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-100', ring: 'border-emerald-400', spin: 'border-t-emerald-600' },
  call:   { bg: 'bg-amber-50 border-amber-200',     text: 'text-amber-700',   dot: 'bg-amber-100',   ring: 'border-amber-400',   spin: 'border-t-amber-600'   },
  voice:  { bg: 'bg-purple-50 border-purple-100',   text: 'text-purple-700',  dot: 'bg-purple-100',  ring: 'border-purple-400',  spin: 'border-t-purple-600'  },
};

const ACTION_KINDS = new Set(['checkin', 'wechat_request', 'call_request', 'voice']);

function formatSeconds(s: number): string {
  const m   = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function deriveStatus(feed: FeedItem[], dismissedId: string | null): StatusInfo {
  const latest      = feed.find((item) => ACTION_KINDS.has(item.kind)) ?? null;
  const lastCheckin = feed.find((i) => i.kind === 'checkin') ?? null;
  const baseGood    = lastCheckin !== null && isWithin24h(lastCheckin.created_at);
  const baseSubtext = lastCheckin
    ? `最后平安信号：${relativeTime(lastCheckin.created_at)}`
    : '还没有收到平安信号';

  if (!latest || latest.id === dismissedId || latest.kind === 'checkin') {
    return { kind: baseGood ? 'safe' : 'idle', label: baseGood ? '一切安好' : '建议问候', icon: baseGood ? '❤️' : '🔔', subtext: baseSubtext, itemId: latest?.id ?? null, dismissible: false };
  }

  const ago = relativeTime(latest.created_at);

  if (latest.kind === 'wechat_request') return { kind: 'wechat', label: '请求回复微信',   icon: '💬', subtext: `${ago}发来请求`, itemId: latest.id, dismissible: true };
  if (latest.kind === 'call_request')   return { kind: 'call',   label: '请求回个电话',   icon: '📞', subtext: `${ago}发来请求`, itemId: latest.id, dismissible: true };
  if (latest.kind === 'voice')          return { kind: 'voice',  label: '收到新语音留言', icon: '🎙️', subtext: `${ago}发来语音`, itemId: latest.id, dismissible: true, audioUrl: latest.audio_url };

  return { kind: baseGood ? 'safe' : 'idle', label: baseGood ? '一切安好' : '建议问候', icon: baseGood ? '❤️' : '🔔', subtext: baseSubtext, itemId: null, dismissible: false };
}

// ── StatusHeader ──────────────────────────────────────────────

interface StatusHeaderProps {
  status:       StatusInfo;
  pulse:        boolean;
  onPulseEnd:   () => void;
  onDismiss:    () => void;
  healthData:   HealthData | null;
  lastMetricAt: string | null;
}

function StatusHeader({ status, pulse, onPulseEnd, onDismiss, healthData, lastMetricAt }: StatusHeaderProps) {
  // ── Watchdog: staleness derived from last health metric ──────
  const minutesSinceMetric = lastMetricAt
    ? (Date.now() - new Date(lastMetricAt).getTime()) / 60_000
    : null;
  const isDormant = minutesSinceMetric !== null && minutesSinceMetric >= DORMANT_MIN && minutesSinceMetric < OFFLINE_MIN;
  const isOffline = minutesSinceMetric !== null && minutesSinceMetric >= OFFLINE_MIN;

  // Anomaly only meaningful when signal is fresh
  const isAnomaly = !isDormant && !isOffline && (healthData?.heartRate ?? 0) > 120;

  const style = isAnomaly
    ? { bg: 'bg-red-50 border-red-200',     text: 'text-red-700',   dot: 'bg-red-100',   ring: 'border-red-400',   spin: 'border-t-red-600'   }
    : isOffline
    ? { bg: 'bg-amber-50 border-amber-100', text: 'text-amber-600', dot: 'bg-amber-100', ring: 'border-amber-300', spin: 'border-t-amber-500' }
    : isDormant
    ? { bg: 'bg-slate-50 border-slate-200', text: 'text-slate-500', dot: 'bg-slate-100', ring: 'border-slate-300', spin: 'border-t-slate-400' }
    : STATUS_STYLE[status.kind];

  const staleMins   = minutesSinceMetric !== null ? Math.round(minutesSinceMetric) : 0;
  const isVoice   = status.kind === 'voice' && !isAnomaly;

  // Breathing speed synced to BPM: 72 bpm → ~2.5 s, 120 bpm → 1.5 s
  const breatheDuration = healthData
    ? `${Math.max(1.5, (60 / healthData.heartRate) * 3).toFixed(1)}s`
    : '4s';

  // ── Voice player state ────────────────────────────────────
  const [signedUrl,   setSignedUrl]   = useState<string | null>(null);
  const [playing,     setPlaying]     = useState(false);
  const [progress,    setProgress]    = useState(0);    // 0–1
  const [duration,    setDuration]    = useState(0);    // seconds
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const supabase = useMemo(() => createClient(), []);

  // Reset audio state whenever the active item changes (new voice or dismiss)
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setSignedUrl(null);
    setPlaying(false);
    setProgress(0);
    setDuration(0);
    setFetchingUrl(false);
  }, [status.itemId]);

  const handlePlayPause = useCallback(async () => {
    if (fetchingUrl) return;

    // Toggle play/pause if URL is already fetched
    if (signedUrl && audioRef.current) {
      if (playing) {
        audioRef.current.pause();
        setPlaying(false);
      } else {
        audioRef.current.play().catch(() => null);
        setPlaying(true);
      }
      return;
    }

    const rawPath = status.audioUrl;
    if (!rawPath) return;

    const ext = rawPath.split(".").pop() ?? "(no extension)";
    console.log("[DEBUG] Final Audio Path:", rawPath);
    console.log("[DEBUG] File extension in DB path:", ext);

    setFetchingUrl(true);
    const { data, error } = await supabase.storage
      .from("voice-memos")
      .createSignedUrl(rawPath, 300);
    setFetchingUrl(false);

    if (error || !data?.signedUrl) {
      console.error("[StatusHeader] createSignedUrl error:", error?.message, "| path:", rawPath);
      return;
    }
    setSignedUrl(data.signedUrl);
  }, [status.audioUrl, signedUrl, playing, fetchingUrl, supabase]);

  // Auto-play once signed URL is ready
  useEffect(() => {
    if (signedUrl && audioRef.current) {
      audioRef.current.play().then(() => setPlaying(true)).catch(() => null);
    }
  }, [signedUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current) return;
    const { currentTime, duration: d } = audioRef.current;
    if (d > 0) setProgress(currentTime / d);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current?.duration) setDuration(audioRef.current.duration);
  }, []);

  const handleEnded = useCallback(() => {
    setPlaying(false);
    setProgress(1);

    // Mark the voice message as read
    if (status.itemId) {
      supabase
        .from("messages")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq("id", status.itemId)
        .then(({ error }) => {
          if (error) console.error("[StatusHeader] mark-read failed:", error.message);
        });
    }

    // Auto-reset to 一切安好 after a brief pause
    setTimeout(onDismiss, 800);
  }, [onDismiss, status.itemId, supabase]);

  return (
    <div
      className={[
        "relative rounded-3xl px-6 py-7 flex flex-col items-center gap-3 overflow-hidden",
        "transition-all duration-500 ease-out border",
        style.bg,
      ].join(" ")}
    >
      {/* Voice progress bar — pinned to bottom edge */}
      {isVoice && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-purple-100">
          <div
            className="h-full bg-purple-400 rounded-br-3xl rounded-bl-3xl"
            style={{
              width: `${progress * 100}%`,
              transition: progress === 0 ? 'none' : 'width 0.25s linear',
            }}
          />
        </div>
      )}
      {/* Realtime pulse ring */}
      {pulse && (
        <span
          onAnimationEnd={onPulseEnd}
          className={`absolute inset-0 rounded-3xl border-2 ${style.ring} animate-[ringBurst_0.7s_ease-out_forwards] pointer-events-none`}
        />
      )}

      {/* Icon — play/pause button in voice mode, emoji otherwise */}
      <div className="relative flex items-center justify-center">
        {isVoice ? (
          <button
            onClick={handlePlayPause}
            disabled={fetchingUrl}
            className={[
              "w-20 h-20 rounded-full flex items-center justify-center",
              "active:scale-95 transition-transform disabled:opacity-50",
              style.dot,
            ].join(" ")}
          >
            {fetchingUrl ? (
              <span className={`w-6 h-6 rounded-full border-2 border-purple-200 ${style.spin} animate-spin`} />
            ) : playing ? (
              <Pause className="w-8 h-8 text-purple-600" />
            ) : (
              <Play className="w-8 h-8 text-purple-600 translate-x-0.5" />
            )}
          </button>
        ) : isOffline ? (
          /* Offline — show '--' text in the circle */
          <span className={["w-20 h-20 rounded-full flex items-center justify-center font-bold text-3xl", style.dot, style.text].join(" ")}>
            --
          </span>
        ) : (
          <span
            className={[
              "w-20 h-20 rounded-full flex items-center justify-center text-4xl",
              style.dot,
              (status.kind === 'safe' || isAnomaly) && !isDormant
                ? "animate-[breathe_4s_ease-in-out_infinite]"
                : "",
            ].join(" ")}
            style={{ animationDuration: breatheDuration }}
          >
            {isAnomaly ? "❤️" : isDormant ? "💤" : status.icon}
          </span>
        )}
        {(status.kind === 'safe' && !isAnomaly && !isDormant && !isOffline) && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 ring-2 ring-white animate-pulse" />
        )}
        {isAnomaly && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 ring-2 ring-white animate-ping" />
        )}
      </div>

      {/* Label */}
      <p className={["text-2xl font-bold tracking-tight", style.text].join(" ")}>
        {isOffline ? '信号断开' : isDormant ? '平安扣休眠中' : isAnomaly ? '心率异常！' : status.label}
      </p>

      {/* Voice: elapsed / total timestamps */}
      {isVoice ? (
        <div className="w-full flex justify-between text-xs text-purple-300 px-2">
          <span>{formatSeconds(progress * (duration || 0))}</span>
          {duration > 0 && <span>{formatSeconds(duration)}</span>}
        </div>
      ) : (
        <>
          <p className={["text-sm", isAnomaly ? "text-red-400" : "text-slate-400"].join(" ")}>
            {isOffline
              ? `${staleMins} 分钟未收到信号`
              : isDormant
              ? `${staleMins} 分钟无动态`
              : isAnomaly
              ? `当前心率 ${healthData!.heartRate} 次/分，请立即确认`
              : status.subtext}
          </p>

          {/* ── Health snapshot (safe / idle / dormant / offline / anomaly) ── */}
          {(status.kind === 'safe' || status.kind === 'idle' || isAnomaly || isDormant || isOffline) && (
            <div className="w-full flex items-center justify-center gap-6 pt-2 pb-0.5">
              {/* Steps */}
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex items-baseline gap-0.5">
                  <span className={["text-2xl font-bold", isAnomaly ? "text-red-400" : isOffline || isDormant ? "text-slate-400" : "text-emerald-500"].join(" ")}>
                    {isOffline ? "--" : healthData ? healthData.steps.toLocaleString() : "--"}
                  </span>
                  {!isOffline && <span className={["text-xs font-medium mb-0.5", isAnomaly ? "text-red-300" : isDormant ? "text-slate-400" : "text-emerald-400"].join(" ")}>步</span>}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-400">步数</span>
                  {!isOffline && !isDormant && <span className={["text-[10px] font-medium", isAnomaly ? "text-red-400" : "text-emerald-400"].join(" ")}>↑ 今日</span>}
                </div>
              </div>

              <div className="w-px h-10 bg-slate-100" />

              {/* Heart rate */}
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex items-baseline gap-0.5">
                  <span className={["text-2xl font-bold", isAnomaly ? "text-red-500" : isOffline || isDormant ? "text-slate-400" : "text-emerald-500"].join(" ")}>
                    {isOffline ? "--" : healthData ? healthData.heartRate : "--"}
                  </span>
                  {!isOffline && <span className={["text-xs font-medium mb-0.5", isAnomaly ? "text-red-400" : isDormant ? "text-slate-400" : "text-emerald-400"].join(" ")}>次/分</span>}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-400">心率</span>
                  <span className={["text-[10px] font-medium", isAnomaly ? "text-red-500 animate-pulse" : isOffline ? "text-amber-400" : isDormant ? "text-slate-400" : "text-emerald-400"].join(" ")}>
                    {isAnomaly ? "⚠ 偏高" : isOffline ? "× 断开" : isDormant ? "○ 休眠" : "● 正常"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Anomaly: Call Mom button */}
          {isAnomaly && (
            <a
              href="tel:"
              className="mt-1 flex items-center gap-2 px-6 py-3 rounded-full bg-red-500 text-white text-base font-semibold active:scale-95 transition-transform shadow-md shadow-red-200"
            >
              📞 立即拨打妈妈
            </a>
          )}
        </>
      )}

      {/* Dismiss button (non-anomaly) */}
      {status.dismissible && !isAnomaly && (
        <button
          onClick={onDismiss}
          className={[
            "mt-1 text-xs px-4 py-1.5 rounded-full border transition-all active:scale-95",
            style.text, "border-current opacity-60 hover:opacity-100",
          ].join(" ")}
        >
          已处理
        </button>
      )}

      {/* Hidden audio element — rendered only once signedUrl is ready */}
      {signedUrl && (
        <audio
          ref={audioRef}
          src={signedUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          className="hidden"
        />
      )}
    </div>
  );
}

// ── SleepInsightsCard helpers ─────────────────────────────────

function SleepBreakdownBar({ session }: { session: SleepSession }) {
  const deep  = session.deep_hours  ?? 0;
  const light = session.light_hours ?? 0;
  const rem   = session.rem_hours   ?? 0;
  const segSum = deep + light + rem;
  if (segSum === 0) return null;

  const deepPct  = ((deep  / segSum) * 100).toFixed(1);
  const lightPct = ((light / segSum) * 100).toFixed(1);
  const remPct   = ((rem   / segSum) * 100).toFixed(1);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-700">
        <div className="bg-indigo-400 transition-all" style={{ width: `${deepPct}%` }} />
        <div className="bg-sky-400 transition-all"    style={{ width: `${lightPct}%` }} />
        <div className="bg-violet-400 transition-all" style={{ width: `${remPct}%` }} />
      </div>
      <div className="flex gap-2 text-[11px] text-slate-400">
        <span>深睡 {session.deep_hours?.toFixed(1)}h</span>
        <span>·</span>
        <span>浅睡 {session.light_hours?.toFixed(1)}h</span>
        <span>·</span>
        <span>REM {session.rem_hours?.toFixed(1)}h</span>
      </div>
    </div>
  );
}

// ── SleepInsightsCard ─────────────────────────────────────────

interface SleepInsightsCardProps {
  session: SleepSession | null;
}

/** Night-mode status panel (23:00–06:00 BJ) */
function NightStatusPanel({
  cs, isAwakeAlert, awakeMinutes,
}: {
  cs:            SleepCurrentState;
  isAwakeAlert:  boolean;
  awakeMinutes:  number;
}) {
  const panelCls =
    cs === 'awake'
      ? isAwakeAlert
        ? 'bg-amber-500/20 border border-amber-400/40'
        : 'bg-yellow-500/10 border border-yellow-400/20'
      : cs === 'deep'  ? 'bg-indigo-500/20 border border-indigo-400/30'
      : cs === 'light' ? 'bg-sky-500/15    border border-sky-400/30'
                       : 'bg-slate-700/40  border border-slate-600/40';

  const icon  = cs === 'awake' ? (isAwakeAlert ? '⚠️' : '😐')
              : cs === 'deep'  ? '💤'
              : cs === 'light' ? '🌙' : '📡';

  const label = cs === 'awake' ? '尚未入睡'
              : cs === 'deep'  ? '深睡中'
              : cs === 'light' ? '浅睡中' : '无睡眠信号';

  const labelCls = cs === 'awake' ? (isAwakeAlert ? 'text-amber-200' : 'text-yellow-200')
                 : cs === 'deep'  ? 'text-indigo-200'
                 : cs === 'light' ? 'text-sky-200' : 'text-slate-400';

  const sub = cs === 'awake'
    ? (isAwakeAlert ? `已持续未眠 ${awakeMinutes} 分钟，建议联系确认` : '老人此时尚未入睡，请留意')
    : cs === 'deep'  ? '正处于深度睡眠，勿打扰'
    : cs === 'light' ? '浅度睡眠中'
    : '平安扣设备暂无数据';

  const subCls = cs === 'awake' ? (isAwakeAlert ? 'text-amber-300' : 'text-yellow-300/70')
               : cs === 'deep'  ? 'text-indigo-300/70'
               : cs === 'light' ? 'text-sky-300/70' : 'text-slate-500';

  return (
    <div className={`rounded-2xl px-4 py-4 flex flex-col items-center gap-3 ${panelCls}`}>
      <span className={`text-5xl ${cs === 'deep' ? 'animate-[breathe_4s_ease-in-out_infinite]' : ''}`}>
        {icon}
      </span>
      <p className={`text-xl font-bold ${labelCls}`}>{label}</p>
      <p className={`text-xs text-center leading-relaxed ${subCls}`}>{sub}</p>
      {isAwakeAlert && (
        <div className="w-full flex items-center justify-center px-3 py-2 rounded-xl bg-amber-500/25 border border-amber-400/40">
          <span className="text-amber-300 text-xs font-semibold">已持续未眠 {awakeMinutes} 分钟</span>
        </div>
      )}
    </div>
  );
}

function SleepInsightsCard({ session }: SleepInsightsCardProps) {
  // ── Beijing time period ───────────────────────────────────────
  const [bjHour, setBjHour] = useState(getBjHour);
  useEffect(() => {
    const id = setInterval(() => setBjHour(getBjHour()), 60_000);
    return () => clearInterval(id);
  }, []);

  // night: 23:00–05:59 | nap: 12:00–14:59 | day: everything else
  const period: 'night' | 'nap' | 'day' =
    bjHour >= 23 || bjHour < 6  ? 'night' :
    bjHour >= 12 && bjHour < 15 ? 'nap'   : 'day';

  const cs = session?.current_state ?? null;

  // ── Awake duration tracker (night only) ──────────────────────
  const awakeSinceRef = useRef<number | null>(null);
  const [awakeMinutes, setAwakeMinutes] = useState(0);
  useEffect(() => {
    if (period === 'night' && cs === 'awake') {
      if (!awakeSinceRef.current) awakeSinceRef.current = Date.now();
      const id = setInterval(() => {
        setAwakeMinutes(Math.floor((Date.now() - awakeSinceRef.current!) / 60_000));
      }, 15_000);
      return () => clearInterval(id);
    }
    awakeSinceRef.current = null;
    setAwakeMinutes(0);
  }, [period, cs]);

  // ── Display mode ──────────────────────────────────────────────
  const isAwakeAlert   = period === 'night' && cs === 'awake' && awakeMinutes >= 30;
  const isNapping      = period === 'nap'   && cs === 'nap';
  const isResting      = cs === 'resting';
  const isMorningSummary = !isNapping && !isResting && period !== 'night'
                           && session !== null && session.total_hours !== null;
  const deepWarn = isMorningSummary && (session!.deep_hours ?? 0) < 1.5;

  const headerLabel =
    period === 'night' ? '夜间监测' :
    isNapping          ? '午间休憩' :
    isResting          ? '静息中'   : '昨晚睡眠';

  const headerBadge: { text: string; cls: string } | null =
    period === 'night' && !isAwakeAlert
      ? { text: '实时睡眠状态', cls: 'border-indigo-400/50 text-indigo-200' }
    : isAwakeAlert
      ? { text: '⚠ 需要留意',   cls: 'border-amber-400/60 text-amber-200 bg-amber-500/10' }
    : isNapping
      ? { text: '午休中',        cls: 'border-orange-400/50 text-orange-200' }
    : isResting
      ? { text: '安静休息',      cls: 'border-emerald-400/50 text-emerald-200' }
    : null;

  return (
    <div
      className={[
        "rounded-3xl shadow-lg px-5 py-5 flex flex-col gap-4 relative overflow-hidden transition-all duration-700",
        isAwakeAlert ? "ring-2 ring-amber-400/60" : "",
      ].join(" ")}
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)' }}
    >
      {/* Stars */}
      <span className="absolute top-3 right-6  w-1   h-1   rounded-full bg-white opacity-70" />
      <span className="absolute top-6 right-12 w-0.5 h-0.5 rounded-full bg-white opacity-40" />
      <span className="absolute top-4 right-20 w-1   h-1   rounded-full bg-white opacity-50" />
      <span className="absolute top-8 right-8  w-0.5 h-0.5 rounded-full bg-white opacity-30" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">
            {period === 'night' ? '🌙' : isNapping ? '☀️' : isResting ? '🌿' : '🌙'}
          </span>
          <p className="text-white font-semibold text-base">{headerLabel}</p>
        </div>
        {headerBadge && (
          <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${headerBadge.cls}`}>
            {headerBadge.text}
          </span>
        )}
      </div>

      {/* Body */}
      {period === 'night' ? (
        <NightStatusPanel cs={cs} isAwakeAlert={isAwakeAlert} awakeMinutes={awakeMinutes} />
      ) : isNapping ? (
        /* ── Nap mode (12–15 BJ, warm orange) ── */
        <div className="rounded-2xl px-4 py-4 flex flex-col items-center gap-3 bg-orange-500/15 border border-orange-400/30">
          <span className="text-5xl">☀️</span>
          <p className="text-xl font-bold text-orange-200">午间休憩中</p>
          <p className="text-xs text-orange-300/70">正在午休，请勿打扰</p>
        </div>
      ) : isResting ? (
        /* ── Resting mode (sage green) ── */
        <div className="rounded-2xl px-4 py-4 flex flex-col items-center gap-3 bg-emerald-500/10 border border-emerald-400/20">
          <span className="text-5xl">🌿</span>
          <p className="text-xl font-bold text-emerald-200">正在静息</p>
          <p className="text-xs text-emerald-300/70">处于安静休息状态</p>
        </div>
      ) : !session ? (
        /* ── Loading skeleton ── */
        <div className="flex flex-col gap-3 py-1">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full border-2 border-indigo-400/40 border-t-indigo-300 animate-spin flex-shrink-0" />
            <span className="text-slate-400 text-sm">正在同步睡眠数据…</span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-slate-700/60 animate-pulse" />
          <div className="flex gap-2 text-[11px] text-slate-600">
            <span>深睡 --</span><span>·</span><span>浅睡 --</span><span>·</span><span>REM --</span>
          </div>
        </div>
      ) : !isMorningSummary ? (
        /* ── Night watch day-mode (no total_hours yet) ── */
        <div className="flex flex-col items-center gap-3 py-2">
          <span className="px-4 py-2 rounded-full text-base font-medium bg-indigo-500/30 text-indigo-200">
            监测中…
          </span>
        </div>
      ) : (
        /* ── Morning summary ── */
        <div className="flex flex-col gap-3">
          <p className={`text-2xl font-bold ${deepWarn ? "text-amber-300" : "text-white"}`}>
            昨晚总睡眠: {session.total_hours?.toFixed(1)}小时
            {deepWarn && <span className="ml-2 text-sm font-normal text-amber-400">深睡不足</span>}
          </p>
          <SleepBreakdownBar session={session} />
        </div>
      )}

      {/* Footer */}
      <p className="text-[10px] text-slate-600 text-right -mt-1">
        基于睡眠模拟数据 · Huawei Health 接入后自动更新
      </p>
    </div>
  );
}

// ── WellnessCard ──────────────────────────────────────────────

const LEVEL_STYLE = {
  great:    { ring: 'text-emerald-500', badge: 'bg-emerald-50 text-emerald-600', label: '状态良好' },
  good:     { ring: 'text-sky-500',     badge: 'bg-sky-50 text-sky-600',         label: '整体平稳' },
  alert:    { ring: 'text-amber-500',   badge: 'bg-amber-50 text-amber-600',     label: '需要关注' },
  critical: { ring: 'text-red-500',     badge: 'bg-red-50 text-red-600',         label: '立即关注' },
};

interface WellnessCardProps {
  wellness: WellnessResult | null;
  loading:  boolean;
}

function WellnessCard({ wellness, loading }: WellnessCardProps) {
  const ls = wellness ? LEVEL_STYLE[wellness.level] : LEVEL_STYLE.good;

  return (
    <div
      className="rounded-3xl bg-white border border-indigo-100 shadow-sm px-5 py-5 flex flex-col gap-4"
      style={{ animation: 'wisdomPulse 4s ease-in-out infinite' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🧠</span>
          <p className="text-slate-700 font-semibold text-base">AI 每日健康分析</p>
        </div>
        {wellness && (
          <span className={["text-[11px] font-medium px-2.5 py-1 rounded-full", ls.badge].join(" ")}>
            {ls.label}
          </span>
        )}
      </div>

      {loading || !wellness ? (
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-indigo-200 border-t-indigo-500 animate-spin" />
          <p className="text-slate-400 text-sm">正在分析健康数据…</p>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          {/* Score ring */}
          <div className="relative shrink-0 w-16 h-16">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f1f5f9" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15.5"
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                className={ls.ring}
                stroke="currentColor"
                strokeDasharray={`${wellness.score} 100`}
                style={{ transition: 'stroke-dasharray 1s ease' }}
              />
            </svg>
            <span className={["absolute inset-0 flex items-center justify-center text-base font-bold", ls.ring].join(" ")}>
              {wellness.score}
            </span>
          </div>

          {/* Advice */}
          <p className="text-slate-600 text-sm leading-relaxed flex-1">
            {wellness.advice}
          </p>
        </div>
      )}

      <p className="text-[10px] text-slate-300 text-right -mt-1">
        基于北京气压 · 心率 · 步数 · 睡眠
      </p>
    </div>
  );
}

// ── EnvTile — BJ clock + weather merged ───────────────────────

interface EnvTileProps {
  weather: WeatherPayload | null;
  loading: boolean;
}

function EnvTile({ weather, loading }: EnvTileProps) {
  const bj = getBjClock();
  return (
    <div className="flex flex-col gap-3">
      {/* Clock row */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-slate-800 text-3xl font-bold tabular-nums leading-none">{bj.time}</p>
          <p className="text-slate-400 text-sm mt-1">北京 · {bj.period}</p>
        </div>
        <div className="text-right flex flex-col items-end gap-0.5">
          {loading && !weather ? (
            <div className="w-5 h-5 rounded-full border-2 border-slate-200 border-t-slate-400 animate-spin" />
          ) : weather ? (
            <>
              <p className="text-slate-700 font-semibold">
                {weatherIcon(weather.icon_code)} {weather.temp_c}°C
              </p>
              <p className="text-slate-400 text-xs">
                {weather.temp_min}–{weather.temp_max}°C · {weather.text}
              </p>
            </>
          ) : null}
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
    </div>
  );
}

// ── SeniorIdentityTile — flat profile + device status ─────────

interface SeniorIdentityTileProps {
  name:         string;
  lastMetricAt: string | null;
}

function SeniorIdentityTile({ name, lastMetricAt }: SeniorIdentityTileProps) {
  const minutesSince = lastMetricAt
    ? (Date.now() - new Date(lastMetricAt).getTime()) / 60_000
    : null;

  const deviceStatus =
    minutesSince === null         ? '未连接'
    : minutesSince >= OFFLINE_MIN ? '信号中断'
    : minutesSince >= DORMANT_MIN ? '休眠中'
    : '在线';

  const dotCls =
    minutesSince === null         ? 'bg-slate-500'
    : minutesSince >= OFFLINE_MIN ? 'bg-amber-400'
    : minutesSince >= DORMANT_MIN ? 'bg-slate-400'
    : 'bg-emerald-400';

  const isLive = minutesSince !== null && minutesSince < DORMANT_MIN;
  const displayName = name.trim() || '长辈';

  return (
    <div
      className="rounded-3xl px-5 py-5 flex flex-col gap-4"
      style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)' }}
    >
      {/* Name + device badge */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-indigo-300 text-[11px] font-medium uppercase tracking-widest mb-1">
            平安扣绑定
          </p>
          <p className="text-white text-xl font-bold">{displayName}的平安扣</p>
          <p className="text-indigo-300/50 text-[11px] mt-1">点击查看 / 编辑信息 ›</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/10">
          <span className={[
            "w-1.5 h-1.5 rounded-full shrink-0",
            dotCls,
            isLive ? "animate-pulse" : "",
          ].join(" ")} />
          <span className="text-white/80 text-xs font-medium">{deviceStatus}</span>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-3 gap-0 divide-x divide-white/10">
        <div className="flex flex-col gap-0.5 pr-4">
          <span className="text-indigo-300/70 text-[11px]">年龄</span>
          <span className="text-white/90 text-sm font-medium">未设置</span>
        </div>
        <div className="flex flex-col gap-0.5 px-4">
          <span className="text-indigo-300/70 text-[11px]">关系</span>
          <span className="text-white/90 text-sm font-medium">家人</span>
        </div>
        <div className="flex flex-col gap-0.5 pl-4">
          <span className="text-indigo-300/70 text-[11px]">所在地</span>
          <span className="text-white/90 text-sm font-medium">北京</span>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function CarerDashboard() {
  const supabase = useMemo(() => createClient(), []);

  const [seniorId,     setSeniorId]     = useState<string | null>(null);
  const [seniorName,   setSeniorName]   = useState<string>('');
  const [checkins,     setCheckins]     = useState<CheckinRow[]>([]);
  const [weather,      setWeather]      = useState<WeatherPayload | null>(null);
  const [weatherLoad,  setWeatherLoad]  = useState(true);
  const [pulse,        setPulse]        = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [pageReady,    setPageReady]    = useState(false);
  const [messages,    setMessages]    = useState<MessageRow[]>([]);
  const [feed,        setFeed]        = useState<FeedItem[]>([]);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [healthData,   setHealthData]   = useState<HealthData | null>(null);
  const [lastMetricAt, setLastMetricAt] = useState<string | null>(null);
  const [sleepSession, setSleepSession] = useState<SleepSession | null>(null);

  // ── Debug: log every sleepSession update ──────────────────────
  useEffect(() => {
    console.log("[carer] sleepSession state:", sleepSession);
  }, [sleepSession]);

  const [bjWeather,    setBjWeather]    = useState<WeatherPayload | null>(null);
  const [bjWeatherLoad,setBjWeatherLoad]= useState(true);
  const [, setClockTick] = useState(0);   // triggers re-render for live clocks


  // ── 1. Load senior + checkins ────────────────────────────────
  const loadData = useCallback(async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) console.error('[carer] auth error:', authError.message);
    if (!user) { setLoading(false); return; }

    // Find the senior this carer watches
    const { data: profiles, error: profilesError } = await supabase
      .from("senior_profiles")
      .select("id, name")
      .limit(1);

    if (profilesError) {
      console.error('[carer] senior_profiles query failed:', profilesError.message, profilesError.code);
    }

    const profile = (profiles?.[0] as { id: string; name: string } | undefined);
    const id = profile?.id ?? null;
    setSeniorId(id);
    setSeniorName(profile?.name ?? '');

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

      // Latest heart_rate + steps rows (vertical schema: metric_type / value / measured_at)
      const { data: healthRows } = await supabase
        .from("health_metrics")
        .select("metric_type, value, measured_at")
        .eq("senior_id", id)
        .in("metric_type", ["heart_rate", "steps"])
        .order("measured_at", { ascending: false })
        .limit(10);

      if (healthRows) {
        type HealthRowRaw = { metric_type: string; value: number; measured_at: string };
        const rows  = healthRows as HealthRowRaw[];
        const hrRow    = rows.find((r) => r.metric_type === "heart_rate");
        const stepsRow = rows.find((r) => r.metric_type === "steps");
        if (hrRow || stepsRow) {
          setHealthData({
            heartRate: hrRow?.value    ?? 75,
            steps:     stepsRow?.value ?? 0,
          });
        }
        // Track most recent metric time for watchdog
        if (rows.length > 0) {
          const newest = rows.reduce((a, b) => a.measured_at > b.measured_at ? a : b);
          setLastMetricAt(newest.measured_at);
        }
      }

      // ── Demo seed: upsert last night's sleep with requested values ────
      // Compute yesterday's date in Beijing timezone.
      const bjNow       = new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" });
      const bjYesterday = new Date(bjNow);
      bjYesterday.setDate(bjYesterday.getDate() - 1);
      const yy  = bjYesterday.getFullYear();
      const ymm = String(bjYesterday.getMonth() + 1).padStart(2, "0");
      const ydd = String(bjYesterday.getDate()).padStart(2, "0");
      const yesterdayStr = `${yy}-${ymm}-${ydd}`;

      const { error: sleepSeedErr } = await (supabase as any)
        .from("sleep_sessions")
        .upsert(
          {
            senior_id:    id,
            session_date: yesterdayStr,
            total_hours:  7.33,   // 7h 20m
            deep_hours:   2.17,   // 2h 10m
            light_hours:  4.0,
            rem_hours:    1.17,   // 1h 10m
          },
          { onConflict: "senior_id,session_date" },
        );
      if (sleepSeedErr) {
        console.warn("[carer] sleep seed upsert failed:", sleepSeedErr.message, sleepSeedErr.code);
      } else {
        console.log("[carer] ✓ sleep seed upsert OK:", yesterdayStr);
      }

      // ── Query most recent sleep session ─────────────────────────
      // select("*") — PostgREST returns all cached columns; current_state
      // appears once the schema cache is refreshed (no date filter).
      console.log("[carer] querying sleep_sessions for senior_id:", id);
      const { data: sleepRows, error: sleepError } = await (supabase as any)
        .from("sleep_sessions")
        .select("*")
        .eq("senior_id", id)
        .order("session_date", { ascending: false })
        .limit(1);

      if (sleepError) {
        console.warn("[carer] sleep_sessions query failed:", sleepError.message, sleepError.code);
      }
      console.log("[carer] sleep query result:", { rows: sleepRows?.length ?? 0, error: sleepError?.message ?? null });
      if (sleepRows && sleepRows.length > 0) {
        setSleepSession(sleepRows[0] as SleepSession);
      } else {
        // DB row missing (seed failed or RLS blocked) — use static fallback so the UI is verifiable
        console.warn("[carer] sleep query returned 0 rows — using static fallback");
        setSleepSession({
          id:            "fallback",
          session_date:  yesterdayStr,
          total_hours:   7.0,
          deep_hours:    2.0,
          light_hours:   3.5,
          rem_hours:     1.5,
          current_state: null,
        });
      }
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
  // No server-side filter — subscribe to ALL inserts, then match
  // senior_id client-side.  This avoids any UUID filter-syntax issues
  // with Supabase Realtime and ensures every event reaches the callback.
  useEffect(() => {
    if (!seniorId) return;

    const channel = supabase
      .channel("carer-dashboard")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "checkins" },
        (payload: RealtimePostgresInsertPayload<CheckinRow>) => {
          const row = payload.new as CheckinRow & { senior_id: string };
          if (row.senior_id !== seniorId) return;
          setCheckins((prev) => [
            { ...row, isNew: true },
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
          const row = payload.new;
          if (row.senior_id !== seniorId) return;
          setMessages((prev) => [row, ...prev.slice(0, 39)]);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload: RealtimePostgresUpdatePayload<MessageRow>) => {
          const updated = payload.new;
          if (updated.senior_id !== seniorId) return;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "health_metrics" },
        (payload: RealtimePostgresInsertPayload<HealthRow>) => {
          const row = payload.new;
          if (row.senior_id !== seniorId) return;
          console.log(`[health-realtime] ${row.metric_type}=${row.value}`);
          // Merge whichever metric_type just arrived; keep the other value intact
          setHealthData((prev) => {
            const base = prev ?? { heartRate: 75, steps: 0 };
            if (row.metric_type === "heart_rate") return { ...base, heartRate: row.value };
            if (row.metric_type === "steps")      return { ...base, steps:     row.value };
            return base;
          });
          // Update watchdog timestamp on every incoming metric
          if (row.measured_at) setLastMetricAt(row.measured_at);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sleep_sessions" },
        (payload: RealtimePostgresUpdatePayload<SleepSession & { senior_id: string }>) => {
          const updated = payload.new;
          if (updated.senior_id !== seniorId) return;
          setSleepSession(updated);
          console.log(`[sleep-realtime] updated session_date=${updated.session_date}`);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sleep_sessions" },
        (payload: RealtimePostgresInsertPayload<SleepSession & { senior_id: string }>) => {
          const row = payload.new;
          if (row.senior_id !== seniorId) return;
          setSleepSession(row);
        },
      )
      .subscribe((status) => {
        console.log("[carer-realtime] channel status:", status);
      });

    return () => { supabase.removeChannel(channel); };
  }, [supabase, seniorId]);

  // ── 3. Weather (Shanghai carer + Beijing senior) ──────────────
  useEffect(() => {
    fetch("/api/weather?city=shanghai")
      .then((r) => r.json())
      .then((d: WeatherPayload) => { if (d.pressure) setWeather(d); })
      .catch(() => null)
      .finally(() => setWeatherLoad(false));
  }, []);

  // Clock tick — keeps Beijing + local time displays current,
  // and re-evaluates watchdog staleness thresholds every 15s.
  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetch("/api/weather?city=beijing")
      .then((r) => r.json())
      .then((d: WeatherPayload) => { if (d.pressure) setBjWeather(d); })
      .catch(() => null)
      .finally(() => setBjWeatherLoad(false));
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

  // Wellness score — recomputes whenever health or weather updates
  const wellness: WellnessResult | null = (healthData || bjWeather) ? calculateSeniorWellness({
    pressure:  bjWeather?.pressure,
    steps:     healthData?.steps,
    heartRate: healthData?.heartRate,
    sleep:     sleepSession?.total_hours ?? 6.5,   // falls back to 6.5h if no sleep_session row exists yet
  }) : null;

  // ── Main ─────────────────────────────────────────────────────

  return (
    <main
      className={[
        "min-h-screen bg-slate-50",
        "transition-opacity duration-500 ease-out",
        pageReady ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <div className="max-w-md mx-auto px-4 pt-8 pb-10 flex flex-col gap-4">

        {/* ① Environment + Compose — single merged tile */}
        <div className="rounded-3xl bg-white border border-slate-100 shadow-sm px-5 py-5 flex flex-col gap-4">
          <EnvTile weather={bjWeather} loading={bjWeatherLoad} />
          <div className="border-t border-slate-100" />
          <div>
            <p className="text-slate-700 font-semibold text-base mb-3">给妈妈发条消息</p>
            <ComposeMessage seniorId={seniorId} />
          </div>
        </div>

        {/* ③④ Vitals cluster — connection + sleep, tight spacing */}
        <div className="flex flex-col gap-3">
          <StatusHeader
            status={status}
            pulse={pulse}
            onPulseEnd={() => setPulse(false)}
            onDismiss={() => setDismissedId(status.itemId)}
            healthData={healthData}
            lastMetricAt={lastMetricAt}
          />
          <SleepInsightsCard session={sleepSession} />
        </div>

        {/* ⑥ AI wellness */}
        <WellnessCard wellness={wellness} loading={bjWeatherLoad && !healthData} />

        {/* ⑥ Senior identity tile — profile entry point */}
        <Link href="/carer/profile" className="block active:scale-[0.98] transition-transform">
          <SeniorIdentityTile name={seniorName} lastMetricAt={lastMetricAt} />
        </Link>

        {/* ⑦ Signal timeline */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm px-5 py-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-slate-700 font-semibold text-base">平安扣信号</p>
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              实时
            </span>
          </div>
          <FamilyTimeline items={feed} />
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-slate-300 pb-2 tabular-nums">
          你的本地时间 {getLocalClock()}
        </p>

      </div>
    </main>
  );
}
