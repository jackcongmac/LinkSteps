// src/app/senior-home/page.tsx
"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import PeaceButton   from "@/components/senior/senior/PeaceButton";
import MessageBanner from "@/components/senior/senior/MessageBanner";
import VoiceRecorder from "@/components/senior/senior/VoiceRecorder";
import type { MessageRow } from "@/types/messages";

export default function SeniorHomePage() {
  const supabase = createClient();

  const [seniorId,     setSeniorId]     = useState<string | null>(null);
  const [latestMsg,    setLatestMsg]    = useState<MessageRow | null>(null);
  const [msgIsNew,     setMsgIsNew]     = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [ready,        setReady]        = useState(false);

  const seniorIdRef = useRef<string | null>(null);

  // ── Load senior profile + latest carer message ────────────
  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: profile } = await supabase
      .from("senior_profiles")
      .select("id")
      .eq("created_by", user.id)
      .single();

    const id = (profile as { id: string } | null)?.id ?? null;
    setSeniorId(id);
    seniorIdRef.current = id;

    if (id) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("*")
        .eq("senior_id", id)
        .eq("type", "text")
        .eq("sender_role", "carer")
        .order("created_at", { ascending: false })
        .limit(1);

      setLatestMsg((msgs as MessageRow[] | null)?.[0] ?? null);
    }

    setLoading(false);
    setTimeout(() => setReady(true), 60);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Realtime: new carer message ───────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("senior-home-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: RealtimePostgresInsertPayload<MessageRow>) => {
          const incoming = payload.new;
          if (
            incoming.senior_id !== seniorIdRef.current ||
            incoming.sender_role !== "carer" ||
            incoming.type !== "text"
          ) return;

          setLatestMsg(incoming);
          setMsgIsNew(true);
          setTimeout(() => setMsgIsNew(false), 1400);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  // ── Mark message as read ──────────────────────────────────
  const handleMarkRead = useCallback(async (id: string) => {
    const { error } = await supabase
      .from("messages")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("[senior-home] mark-read failed:", error.message);
      return;
    }
    setLatestMsg((prev) => prev ? { ...prev, is_read: true } : prev);
  }, [supabase]);

  // ── Loading ───────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-emerald-200 border-t-emerald-500 animate-spin" />
      </main>
    );
  }

  if (!seniorId) {
    return (
      <main className="min-h-screen bg-stone-50 flex flex-col items-center justify-center gap-4 px-10">
        <p className="text-stone-500 text-xl text-center leading-relaxed">
          请让家人帮您完成初始设置
        </p>
      </main>
    );
  }

  // ── Main ──────────────────────────────────────────────────
  return (
    <main
      className={[
        "min-h-screen bg-stone-50",
        "flex flex-col items-center justify-center gap-8",
        "transition-opacity duration-500 ease-out px-6",
        ready ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      <MessageBanner
        message={latestMsg}
        isNew={msgIsNew}
        onMarkRead={handleMarkRead}
      />

      <PeaceButton
        seniorId={seniorId}
        carerName="小杰"
      />

      <VoiceRecorder seniorId={seniorId} />
    </main>
  );
}
