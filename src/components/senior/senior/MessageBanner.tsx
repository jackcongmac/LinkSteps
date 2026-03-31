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

      {/* Message bubble — read-only display */}
      <div
        className={[
          "w-full rounded-3xl px-5 py-4",
          "border transition-all duration-300",
          message
            ? "bg-white border-slate-100 shadow-sm"
            : "bg-slate-50 border-slate-100",
        ].join(" ")}
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl shrink-0 mt-0.5">💬</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400 mb-1">Jack 的留言</p>
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
      </div>
    </div>
  );
}
