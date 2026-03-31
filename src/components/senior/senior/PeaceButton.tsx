"use client";

/**
 * PeaceButton (平安扣)
 *
 * The one and only interactive element on the senior home screen.
 *
 * States:
 *   idle    — emerald circle, breathing animation, hint text below
 *   sending — scale-down, no animation (brief)
 *   success — circle stays emerald, text changes to success message
 *
 * Resilience rule:
 *   The UI ALWAYS transitions to success after a tap, regardless of
 *   whether the Supabase insert succeeds or fails. Seniors never see
 *   an error state.
 */

import { useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";

type ButtonState = "idle" | "sending" | "success";

// The Figma peace icon path (node 1:57)
function PeaceIcon() {
  return (
    <svg
      viewBox="0 0 100 45.8333"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-20 h-auto"
      aria-hidden="true"
    >
      <path
        d="M22.9167 45.8333C16.5278 45.8333 11.1111 43.6111 6.66667 39.1667C2.22222 34.7222 0 29.3056 0 22.9167C0 16.5278 2.22222 11.1111 6.66667 6.66667C11.1111 2.22222 16.5278 0 22.9167 0C25.4861 0 27.9514 0.451389 30.3125 1.35417C32.6736 2.25694 34.7917 3.54167 36.6667 5.20833L43.75 11.6667L37.5 17.2917L31.0417 11.4583C29.9306 10.4861 28.6806 9.72222 27.2917 9.16667C25.9028 8.61111 24.4444 8.33333 22.9167 8.33333C18.8889 8.33333 15.4514 9.75694 12.6042 12.6042C9.75694 15.4514 8.33333 18.8889 8.33333 22.9167C8.33333 26.9444 9.75694 30.3819 12.6042 33.2292C15.4514 36.0764 18.8889 37.5 22.9167 37.5C24.4444 37.5 25.9028 37.2222 27.2917 36.6667C28.6806 36.1111 29.9306 35.3472 31.0417 34.375L63.3333 5.20833C65.2083 3.54167 67.3264 2.25694 69.6875 1.35417C72.0486 0.451389 74.5139 0 77.0833 0C83.4722 0 88.8889 2.22222 93.3333 6.66667C97.7778 11.1111 100 16.5278 100 22.9167C100 29.3056 97.7778 34.7222 93.3333 39.1667C88.8889 43.6111 83.4722 45.8333 77.0833 45.8333C74.5139 45.8333 72.0486 45.3819 69.6875 44.4792C67.3264 43.5764 65.2083 42.2917 63.3333 40.625L56.25 34.1667L62.5 28.5417L68.9583 34.375C70.0694 35.3472 71.3194 36.1111 72.7083 36.6667C74.0972 37.2222 75.5556 37.5 77.0833 37.5C81.1111 37.5 84.5486 36.0764 87.3958 33.2292C90.2431 30.3819 91.6667 26.9444 91.6667 22.9167C91.6667 18.8889 90.2431 15.4514 87.3958 12.6042C84.5486 9.75694 81.1111 8.33333 77.0833 8.33333C75.5556 8.33333 74.0972 8.61111 72.7083 9.16667C71.3194 9.72222 70.0694 10.4861 68.9583 11.4583L36.6667 40.625C34.7917 42.2917 32.6736 43.5764 30.3125 44.4792C27.9514 45.3819 25.4861 45.8333 22.9167 45.8333Z"
        fill="white"
      />
    </svg>
  );
}

interface PeaceButtonProps {
  seniorId: string | null;
  carerName?: string;
  onSuccess?: () => void;
}

export default function PeaceButton({
  seniorId,
  carerName = "小杰",
  onSuccess,
}: PeaceButtonProps) {
  const [state, setState] = useState<ButtonState>("idle");
  const supabase = createClient();

  const handlePress = useCallback(async () => {
    if (state !== "idle") return;

    setState("sending");

    // Haptic feedback
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([60, 30, 60]);
    }

    // Resolve seniorId if not provided by parent
    let resolvedId = seniorId;
    if (!resolvedId) {
      const { data: profiles } = await supabase
        .from("senior_profiles")
        .select("id")
        .limit(1);
      resolvedId = (profiles?.[0] as { id: string } | undefined)?.id ?? null;
    }

    // UI always shows success — senior never sees an error state
    setState("success");
    onSuccess?.();

    // Fire-and-forget insert
    if (resolvedId) {
      supabase.from("checkins").insert({
        senior_id: resolvedId,
        source: "button",
      }).then(({ error }) => {
        if (error) console.error("[PeaceButton] insert failed:", error.message);
      });
    }

    // Reset to idle after 4 s
    setTimeout(() => setState("idle"), 4000);
  }, [state, seniorId, onSuccess, supabase]);

  const isIdle    = state === "idle";
  const isSuccess = state === "success";

  return (
    <div className="flex flex-col items-center gap-8">
      {/* ── Circle button ── */}
      <button
        onClick={handlePress}
        disabled={state === "sending"}
        aria-label="发送平安信号"
        className={[
          "w-64 h-64 rounded-full bg-emerald-500",
          "flex items-center justify-center",
          "transition-transform duration-150",
          "active:scale-95",
          "focus:outline-none",
          // Breathing only when idle
          isIdle ? "animate-[breathe_3.2s_ease-in-out_infinite]" : "",
          // Quick scale-down during send
          state === "sending" ? "scale-95" : "",
        ].join(" ")}
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        <PeaceIcon />
      </button>

      {/* ── Status text below ── */}
      <p
        className={[
          "text-center text-xl leading-relaxed px-6 transition-all duration-500",
          isSuccess
            ? "text-emerald-700 font-bold"
            : "text-stone-500 font-normal",
        ].join(" ")}
      >
        {isSuccess
          ? `${carerName}已收到您的平安信号 ❤️`
          : "碰一下，报个平安"}
      </p>
    </div>
  );
}
