/**
 * AiInsightCard
 *
 * The dominant visual element on the senior home screen.
 * Displays the AI-generated daily insight in calm, plain Chinese.
 *
 * Design rules:
 *  - No border — warm accent glow shadow instead
 *  - Large readable text (text-xl, leading-relaxed)
 *  - Soft fade-in on mount / content change
 *  - Skeleton state while data is loading
 */

"use client";

import { useEffect, useState } from "react";

interface AiInsightCardProps {
  text:    string | null;  // null = loading / not yet received
  loading?: boolean;
}

const PLACEHOLDER =
  "妈，今天气压平稳，您昨晚睡得很沉。下午如果去公园散步，是个好天气。" +
  "明天下午花粉可能会升高，我们最好上午出门。";

export default function AiInsightCard({ text, loading = false }: AiInsightCardProps) {
  // Fade-in whenever text changes
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, [text]);

  const displayText = text ?? PLACEHOLDER;

  return (
    <div
      className={[
        "rounded-[32px] px-7 py-7",
        "bg-senior-surface",
        // Warm accent glow — no hard border
        "shadow-[0_8px_40px_rgba(110,144,117,0.18)]",
        "transition-all duration-[400ms] ease-out",
      ].join(" ")}
    >
      {/* Label */}
      <p className="text-[11px] text-senior-accent tracking-[0.12em] uppercase mb-4 font-medium">
        今日状态
      </p>

      {loading ? (
        /* Skeleton */
        <div className="flex flex-col gap-3">
          {[1, 0.75, 0.5].map((w, i) => (
            <div
              key={i}
              className="h-5 rounded-full bg-senior-muted/20 animate-pulse"
              style={{ width: `${w * 100}%` }}
            />
          ))}
        </div>
      ) : (
        /* Insight text */
        <p
          className={[
            "text-senior-text text-[19px] leading-[1.75] font-normal",
            "transition-opacity duration-[400ms] ease-out",
            visible ? "opacity-100" : "opacity-0",
          ].join(" ")}
        >
          {displayText}
        </p>
      )}
    </div>
  );
}
