// src/components/senior/senior/QuickRequest.tsx
"use client";

import { useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase";
import { WECHAT_REQUEST, CALL_REQUEST } from "@/types/messages";

type BtnState = "idle" | "sending" | "sent";

interface Props {
  seniorId: string | null;
}

export default function QuickRequest({ seniorId }: Props) {
  const [wechatState, setWechatState] = useState<BtnState>("idle");
  const [callState,   setCallState]   = useState<BtnState>("idle");
  const supabase = useMemo(() => createClient(), []);

  const send = useCallback(async (
    content: string,
    setState: (s: BtnState) => void,
  ) => {
    if (!seniorId) return;
    setState("sending");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setState("idle"); return; }

    const { error } = await supabase.from("messages").insert({
      senior_id:   seniorId,
      sender_id:   user.id,
      sender_role: "senior",
      type:        "text",
      content,
    });

    if (error) {
      console.error("[QuickRequest] send failed:", error.message);
      setState("idle");
      return;
    }

    setState("sent");
    setTimeout(() => setState("idle"), 2500);
  }, [seniorId, supabase]);

  return (
    <div className="flex gap-3">
      {/* 回个微信 */}
      <button
        onClick={() => send(WECHAT_REQUEST, setWechatState)}
        disabled={wechatState !== "idle" || !seniorId}
        className={[
          "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full text-base",
          "border transition-all duration-150 active:scale-95 disabled:opacity-50",
          wechatState === "sent"
            ? "bg-emerald-100 border-emerald-200 text-emerald-600"
            : "bg-white border-emerald-200 text-emerald-600",
        ].join(" ")}
      >
        {wechatState === "sending" ? (
          <span className="w-4 h-4 rounded-full border-2 border-emerald-300 border-t-emerald-600 animate-spin" />
        ) : wechatState === "sent" ? (
          "✅ 已发"
        ) : (
          "💬 回个微信"
        )}
      </button>

      {/* 回个电话 */}
      <button
        onClick={() => send(CALL_REQUEST, setCallState)}
        disabled={callState !== "idle" || !seniorId}
        className={[
          "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full text-base",
          "border transition-all duration-150 active:scale-95 disabled:opacity-50",
          callState === "sent"
            ? "bg-amber-100 border-amber-200 text-amber-600"
            : "bg-white border-amber-200 text-amber-600",
        ].join(" ")}
      >
        {callState === "sending" ? (
          <span className="w-4 h-4 rounded-full border-2 border-amber-300 border-t-amber-600 animate-spin" />
        ) : callState === "sent" ? (
          "✅ 已发"
        ) : (
          "📞 回个电话"
        )}
      </button>
    </div>
  );
}
