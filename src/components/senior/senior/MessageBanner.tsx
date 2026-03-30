// src/components/senior/senior/MessageBanner.tsx
"use client";

import { useEffect, useRef } from "react";
import type { MessageRow } from "@/types/messages";

interface Props {
  message:    MessageRow | null;
  isNew:      boolean;
  onMarkRead: (id: string) => void;
}

export default function MessageBanner({ message, isNew, onMarkRead }: Props) {
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsAvailable =
    typeof window !== "undefined" && "speechSynthesis" in window;

  // Auto-mark read after 3 seconds of visibility
  useEffect(() => {
    if (!message || message.is_read) return;

    readTimerRef.current = setTimeout(() => {
      onMarkRead(message.id);
    }, 3000);

    return () => {
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
    };
  }, [message?.id, message?.is_read, onMarkRead]);

  function speak() {
    if (!message?.content || !ttsAvailable) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(message.content);
    utt.lang = "zh-CN";
    utt.rate = 0.88;
    window.speechSynthesis.speak(utt);
  }

  return (
    <div className="relative w-full max-w-xs">

      {/* HeartBurst — inlined keyframe animation */}
      {isNew && (
        <div
          className="absolute inset-0 pointer-events-none overflow-visible"
          aria-hidden="true"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="absolute text-xl animate-[heartFloat_1.2s_ease-out_forwards]"
              style={{
                left:           `${12 + i * 17}%`,
                bottom:         "100%",
                animationDelay: `${i * 0.09}s`,
              }}
            >
              ❤️
            </span>
          ))}
        </div>
      )}

      {/* Message bubble — tappable for TTS */}
      <button
        onClick={speak}
        disabled={!message}
        className={[
          "w-full rounded-3xl px-5 py-4 text-left",
          "border transition-all duration-300",
          message
            ? "bg-white border-slate-100 shadow-sm active:scale-[0.98] cursor-pointer"
            : "bg-slate-50 border-slate-100 cursor-default",
        ].join(" ")}
        aria-label={message ? "点击朗读消息" : undefined}
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl shrink-0 mt-0.5">💬</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400 mb-1 flex items-center gap-1.5">
              Jack 的留言
              {ttsAvailable && message && (
                <span className="text-slate-300 text-xs">· 点击朗读 🔊</span>
              )}
            </p>
            <p
              className={[
                "text-lg leading-relaxed break-words",
                message ? "text-slate-700" : "text-slate-400 italic",
              ].join(" ")}
            >
              {message?.content ?? "Jack 还没有留言"}
            </p>
          </div>
        </div>
      </button>
    </div>
  );
}
