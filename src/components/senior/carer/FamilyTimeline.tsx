// src/components/senior/carer/FamilyTimeline.tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { FeedItem } from "@/types/messages";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min  = Math.floor(diff / 60_000);
  if (min < 1)  return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h} 小时前`;
  if (h < 48)   return "昨天 " + absoluteHHMM(iso);
  return `${Math.floor(h / 24)} 天前`;
}

function absoluteHHMM(iso: string): string {
  const d  = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

interface VoicePlayButtonProps {
  messageId: string;
}

function VoicePlayButton({ messageId }: VoicePlayButtonProps) {
  const [loading,  setLoading]  = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing,  setPlaying]  = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlay = useCallback(async () => {
    if (loading) return;

    if (audioUrl && audioRef.current) {
      audioRef.current.play();
      setPlaying(true);
      return;
    }

    setLoading(true);
    const res = await fetch(`/api/senior/voice-url?messageId=${messageId}`);
    setLoading(false);

    if (!res.ok) {
      console.error("[VoicePlayButton] fetch failed:", res.status);
      return;
    }

    const { url } = (await res.json()) as { url: string; mimeType: string };
    setAudioUrl(url);
  }, [messageId, loading, audioUrl]);

  useEffect(() => {
    if (audioUrl && audioRef.current && !playing) {
      audioRef.current.play().then(() => setPlaying(true)).catch(() => null);
    }
  }, [audioUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handlePlay}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs text-sky-600 bg-sky-50 px-2.5 py-1 rounded-full active:scale-95 transition-transform disabled:opacity-50"
      >
        {loading ? (
          <span className="w-3 h-3 rounded-full border-2 border-sky-300 border-t-sky-600 animate-spin" />
        ) : (
          <span>{playing ? "🔉" : "▶"}</span>
        )}
        {loading ? "加载中…" : playing ? "播放中" : "播放"}
      </button>

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      )}
    </div>
  );
}

interface Props {
  items: FeedItem[];
}

export default function FamilyTimeline({ items }: Props) {
  if (items.length === 0) {
    return (
      <p className="text-slate-400 text-sm text-center py-8">暂无记录</p>
    );
  }

  return (
    <ol className="relative flex flex-col gap-0">
      {items.map((item, i) => {
        const isFirst = i === 0;

        return (
          <li
            key={item.id}
            className="relative flex gap-4 pb-6"
          >
            {i < items.length - 1 && (
              <div className="absolute left-[9px] top-5 bottom-0 w-px bg-slate-100" />
            )}

            <div
              className={[
                "relative z-10 mt-1 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px]",
                isFirst ? "bg-emerald-500 ring-4 ring-emerald-100" : "bg-slate-200",
              ].join(" ")}
            >
              {isFirst && <div className="w-2 h-2 rounded-full bg-white" />}
            </div>

            <div className="flex flex-col gap-1 pt-0.5 flex-1 min-w-0">

              {item.kind === "checkin" && (
                <>
                  <p className={["text-sm font-medium", isFirst ? "text-emerald-700" : "text-slate-600"].join(" ")}>
                    发送了平安信号
                  </p>
                  <p className="text-xs text-slate-400">
                    {relativeTime(item.created_at)}
                    <span className="mx-1.5 opacity-40">·</span>
                    {absoluteHHMM(item.created_at)}
                  </p>
                </>
              )}

              {item.kind === "text" && (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={["text-sm font-medium", isFirst ? "text-emerald-700" : "text-slate-600"].join(" ")}>
                      {item.sender_role === "carer" ? "💬 你发了一条消息" : "💬 妈妈回复了"}
                    </p>
                    {item.is_read && (
                      <span className="text-[10px] text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                        已读
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 break-words">{item.content}</p>
                  <p className="text-xs text-slate-400">
                    {relativeTime(item.created_at)}
                    <span className="mx-1.5 opacity-40">·</span>
                    {absoluteHHMM(item.created_at)}
                  </p>
                </>
              )}

              {item.kind === "voice" && (
                <>
                  <p className={["text-sm font-medium", isFirst ? "text-emerald-700" : "text-slate-600"].join(" ")}>
                    {item.sender_role === "senior" ? "🎙 妈妈发来一段语音" : "🎙 你发了一段语音"}
                  </p>
                  <VoicePlayButton messageId={item.id} />
                  <p className="text-xs text-slate-400">
                    {relativeTime(item.created_at)}
                    <span className="mx-1.5 opacity-40">·</span>
                    {absoluteHHMM(item.created_at)}
                  </p>
                </>
              )}

              {item.kind === "wechat_request" && (
                <>
                  <div className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-emerald-50 border border-emerald-100">
                    <span className="text-base">💬</span>
                    <p className="text-sm font-medium text-emerald-700">妈妈想和你微信视频</p>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {relativeTime(item.created_at)}
                    <span className="mx-1.5 opacity-40">·</span>
                    {absoluteHHMM(item.created_at)}
                  </p>
                </>
              )}

              {item.kind === "call_request" && (
                <>
                  <div className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-amber-50 border border-amber-100">
                    <span className="text-base">📞</span>
                    <p className="text-sm font-medium text-amber-700">妈妈想让你打电话</p>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {relativeTime(item.created_at)}
                    <span className="mx-1.5 opacity-40">·</span>
                    {absoluteHHMM(item.created_at)}
                  </p>
                </>
              )}

            </div>
          </li>
        );
      })}
    </ol>
  );
}
