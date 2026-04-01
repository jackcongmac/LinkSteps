// src/components/senior/carer/ComposeMessage.tsx
"use client";

import { useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase";

interface Props {
  seniorId: string | null;
}

const MAX_CHARS = 100;

export default function ComposeMessage({ seniorId }: Props) {
  const [text,    setText]    = useState("");
  const [sending, setSending] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [err,     setErr]     = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !seniorId || sending) return;
    setSending(true);
    setErr(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSending(false); setErr("请先登录"); return; }

    // Try profile first; fall back to email prefix so there's always a name
    const { data: prof } = await supabase
      .from("profiles")
      .select("display_name, relation_title")
      .eq("id", user.id)
      .maybeSingle();
    const p = prof as { display_name?: string; relation_title?: string } | null;
    const name = p?.relation_title || p?.display_name || user.email?.split("@")[0] || null;

    const { error } = await supabase.from("messages").insert({
      senior_id:   seniorId,
      sender_id:   user.id,
      sender_role: "carer",
      sender_name: name,
      type:        "text",
      content:     trimmed,
    });

    setSending(false);

    if (error) {
      console.error("[ComposeMessage] send failed:", error.message);
      setErr("发送失败，请重试");
      return;
    }

    setText("");
    setSent(true);
    setTimeout(() => setSent(false), 2000);
  }, [text, seniorId, sending, supabase]);

  const canSend = text.trim().length > 0 && text.length <= MAX_CHARS && !!seniorId && !sending;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-3xl border border-slate-100 shadow-sm">
        <input
          type="text"
          value={text}
          onChange={(e) => { setText(e.target.value.slice(0, MAX_CHARS)); setErr(null); }}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="给妈妈发条消息…"
          disabled={sending}
          className="flex-1 text-sm text-slate-700 placeholder:text-slate-300 outline-none bg-transparent"
        />
        <button
          onClick={send}
          disabled={!canSend}
          className={[
            "px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150",
            sent
              ? "bg-emerald-100 text-emerald-600 animate-[confettiBurst_0.4s_ease-out]"
              : "bg-sky-500 text-white active:scale-95",
            !canSend ? "opacity-40 cursor-not-allowed" : "",
          ].join(" ")}
        >
          {sent ? "✅ 已发" : sending ? "…" : "发送"}
        </button>
      </div>
      {err && (
        <p className="text-xs text-red-400 px-4">{err}</p>
      )}
    </div>
  );
}
