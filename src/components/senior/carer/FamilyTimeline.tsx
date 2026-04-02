// src/components/senior/carer/FamilyTimeline.tsx
"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { FeedItem } from "@/types/messages";

// ── Time helpers (Beijing timezone) ──────────────────────────

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

function formatTimestamp(iso: string): string {
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

function dayGroupLabel(iso: string): string {
  const n = bjDaysAgo(iso);
  if (n === 0) return "今天";
  if (n === 1) return "昨天";
  return bjWeekday(iso);
}

// ── VoicePlayButton ───────────────────────────────────────────

function VoicePlayButton({ audioUrl }: { audioUrl: string }) {
  const [loading,   setLoading]   = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [playing,   setPlaying]   = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const handlePlay = useCallback(async () => {
    if (loading) return;
    if (signedUrl && audioRef.current) {
      audioRef.current.play().catch(() => null);
      setPlaying(true);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.storage
      .from("voice-memos")
      .createSignedUrl(audioUrl, 60);
    setLoading(false);
    if (error || !data?.signedUrl) {
      console.error("[VoicePlayButton] createSignedUrl failed:", error?.message, "| path:", audioUrl);
      return;
    }
    setSignedUrl(data.signedUrl);
  }, [audioUrl, loading, signedUrl, supabase]);

  useEffect(() => {
    if (signedUrl && audioRef.current && !playing) {
      audioRef.current.play().then(() => setPlaying(true)).catch(() => null);
    }
  }, [signedUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handlePlay}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs text-sky-600 bg-sky-50 px-2.5 py-1 rounded-full active:scale-95 transition-transform disabled:opacity-50"
      >
        {loading
          ? <span className="w-3 h-3 rounded-full border-2 border-sky-300 border-t-sky-600 animate-spin" />
          : <span>{playing ? "🔉" : "▶"}</span>
        }
        {loading ? "加载中…" : playing ? "播放中" : "播放"}
      </button>
      {signedUrl && (
        <audio ref={audioRef} src={signedUrl} onEnded={() => setPlaying(false)} className="hidden" />
      )}
    </div>
  );
}

// ── ItemContent ───────────────────────────────────────────────

function ItemContent({
  item,
  isLatest,
  seniorName,
  onCallPressed,
}: {
  item:           FeedItem;
  isLatest:       boolean;
  seniorName:     string;
  onCallPressed?: (id: string) => void;
}) {
  const labelCls = ["text-sm font-medium", isLatest ? "text-emerald-700" : "text-slate-600"].join(" ");
  const ts = <p className="text-xs text-slate-400">{formatTimestamp(item.created_at)}</p>;

  if (item.kind === "checkin") return (
    <div className="flex flex-col gap-1 pt-0.5 flex-1 min-w-0">
      <p className={labelCls}>发送了平安信号</p>
      {ts}
    </div>
  );

  if (item.kind === "text") return (
    <div className="flex flex-col gap-1 pt-0.5 flex-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <p className={labelCls}>
          {item.sender_role === "carer" ? "💬 你发了一条消息" : "💬 妈妈回复了"}
        </p>
        {item.is_read && (
          <span className="text-[10px] text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded-full">已读</span>
        )}
      </div>
      <p className="text-xs text-slate-500 break-words">{item.content}</p>
      {ts}
    </div>
  );

  if (item.kind === "voice") return (
    <div className="flex flex-col gap-1 pt-0.5 flex-1 min-w-0">
      <p className={labelCls}>
        {item.sender_role === "senior" ? "🎙 妈妈发来一段语音" : "🎙 你发了一段语音"}
      </p>
      <VoicePlayButton audioUrl={item.audio_url} />
      {ts}
    </div>
  );

  if (item.kind === "wechat_request") return (
    <div className="flex flex-col gap-1 pt-0.5 flex-1 min-w-0">
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-emerald-50 border border-emerald-100">
        <span className="text-base">💬</span>
        <p className="text-sm font-medium text-emerald-700">给{seniorName}回个微信</p>
      </div>
      <p className="text-xs text-slate-400 mt-0.5">{formatTimestamp(item.created_at)}</p>
    </div>
  );

  if (item.kind === "call_request") return (
    <div className="flex flex-col gap-1 pt-0.5 flex-1 min-w-0">
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-amber-50 border border-amber-100">
        <span className="text-base">📞</span>
        <p className="text-sm font-medium text-amber-700">给{seniorName}回个电话</p>
      </div>
      <p className="text-xs text-slate-400 mt-0.5">{formatTimestamp(item.created_at)}</p>
    </div>
  );

  if (item.kind === "alert") return (
    <div className="flex flex-col gap-1 pt-0.5 flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <div className="flex-1 inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-red-50 border border-red-100 min-w-0">
          <span className="text-base shrink-0">⚠️</span>
          <p className="text-sm font-medium text-red-700 leading-snug">{item.content}</p>
        </div>
        <a
          href="tel:"
          onClick={() => onCallPressed?.(item.id)}
          className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-2xl bg-red-500 text-white text-xs font-semibold active:scale-95 transition-transform"
        >
          📞 打电话
        </a>
      </div>
      <p className="text-xs text-slate-400 mt-0.5">{formatTimestamp(item.created_at)}</p>
    </div>
  );

  return null;
}

// ── FamilyTimeline ────────────────────────────────────────────

const MAX_DAYS = 7;
const AUTO_COLLAPSE_MS = 3 * 60 * 1000; // 3 minutes

export default function FamilyTimeline({ items, seniorName }: { items: FeedItem[]; seniorName: string }) {
  const [daysShown,    setDaysShown]    = useState(1);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const handleCallPressed = useCallback(async (id: string) => {
    // Immediately hide the alert in the timeline
    setDismissedIds((prev) => new Set([...prev, id]));
    // Mark as read in DB — fire-and-forget, don't block the phone dialer
    supabase
      .from("messages")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id)
      .then(({ error }) => {
        if (error) console.warn("[FamilyTimeline] mark-read failed:", error.message);
      });
  }, [supabase]);

  // Start/reset auto-collapse timer whenever user expands beyond today
  useEffect(() => {
    if (daysShown <= 1) {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
      return;
    }
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setDaysShown(1), AUTO_COLLAPSE_MS);
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    };
  }, [daysShown]);

  const collapse = () => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    setDaysShown(1);
  };

  const visibleItems = useMemo(
    () => items.filter((it) => bjDaysAgo(it.created_at) < daysShown && !dismissedIds.has(it.id)),
    [items, daysShown, dismissedIds],
  );

  const hasMore =
    daysShown < MAX_DAYS &&
    items.some((it) => bjDaysAgo(it.created_at) === daysShown);

  const isExpanded = daysShown > 1;

  const groups = useMemo(() => {
    const result: { label: string; items: FeedItem[] }[] = [];
    for (const item of visibleItems) {
      const d    = bjDateStr(item.created_at);
      const last = result[result.length - 1];
      if (last && bjDateStr(last.items[0].created_at) === d) {
        last.items.push(item);
      } else {
        result.push({ label: dayGroupLabel(item.created_at), items: [item] });
      }
    }
    return result;
  }, [visibleItems]);

  if (items.length === 0) {
    return <p className="text-slate-400 text-sm text-center py-8">暂无记录</p>;
  }

  return (
    <div>
      {groups.length === 0 ? (
        <p className="text-slate-400 text-sm text-center py-6">今天暂无记录</p>
      ) : (
        groups.map((group, gi) => (
          <div key={group.label}>
            <div className={["flex items-center gap-2", gi > 0 ? "mt-5 mb-2" : "mb-3"].join(" ")}>
              <span className="text-[11px] font-semibold text-slate-400 tracking-wide shrink-0">
                {group.label}
              </span>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            <ol className="relative flex flex-col gap-0">
              {group.items.map((item, i) => {
                const isLatest  = gi === 0 && i === 0;
                const isLastRow = gi === groups.length - 1 && i === group.items.length - 1;
                const dotCls =
                  item.kind === "wechat_request"
                    ? isLatest ? "bg-emerald-500 ring-4 ring-emerald-100" : "bg-emerald-200"
                    : item.kind === "call_request"
                    ? isLatest ? "bg-amber-400 ring-4 ring-amber-100" : "bg-amber-200"
                    : item.kind === "alert"
                    ? isLatest ? "bg-red-500 ring-4 ring-red-100" : "bg-red-200"
                    : isLatest ? "bg-emerald-500 ring-4 ring-emerald-100" : "bg-slate-200";
                return (
                  <li key={item.id} className="relative flex gap-4 pb-6">
                    {!isLastRow && (
                      <div className="absolute left-[9px] top-5 bottom-0 w-px bg-slate-100" />
                    )}
                    <div className={`relative z-10 mt-1 w-5 h-5 rounded-full shrink-0 flex items-center justify-center ${dotCls}`}>
                      {isLatest && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                    <ItemContent item={item} isLatest={isLatest} seniorName={seniorName} onCallPressed={handleCallPressed} />
                  </li>
                );
              })}
            </ol>
          </div>
        ))
      )}

      <div className="flex items-center gap-2 mt-1">
        {hasMore && (
          <button
            type="button"
            onClick={() => setDaysShown((d) => d + 1)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-slate-400 active:scale-95 transition-all"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            显示更多
          </button>
        )}
        {isExpanded && (
          <button
            type="button"
            onClick={collapse}
            className={[
              "flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-slate-400 active:scale-95 transition-all",
              hasMore ? "flex-1 border-l border-slate-100" : "w-full",
            ].join(" ")}
          >
            <ChevronUp className="w-3.5 h-3.5" />
            收起
          </button>
        )}
      </div>
    </div>
  );
}
