// src/app/senior-home/page.tsx
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";
import PeaceButton    from "@/components/senior/senior/PeaceButton";
import MessageBanner  from "@/components/senior/senior/MessageBanner";
import VoiceRecorder  from "@/components/senior/senior/VoiceRecorder";
import QuickRequest   from "@/components/senior/senior/QuickRequest";
import type { MessageRow } from "@/types/messages";
import { startHealthSimulator } from "@/lib/health-simulator";
import type { WeatherPayload } from "@/app/api/weather/route";

export default function SeniorHomePage() {
  // ── Stable Supabase instance — never recreate on render ──────
  const supabase = useMemo(() => createClient(), []);

  const [seniorId,   setSeniorId]   = useState<string | null>(null);
  const [latestMsg,  setLatestMsg]  = useState<MessageRow | null>(null);
  const [msgIsNew,   setMsgIsNew]   = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [ready,      setReady]      = useState(false);
  const [weather,    setWeather]    = useState<WeatherPayload | null>(null);

  // ── Load senior profile + latest carer message ────────────────
  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Use limit(1) — same as carer dashboard — so both devices resolve
    // the same senior_profile row (e.g. 3d778d6b8b09) and share one
    // senior_id for messages + storage paths.
    const { data: profiles } = await supabase
      .from("senior_profiles")
      .select("id")
      .limit(1);

    const id = (profiles?.[0] as { id: string } | undefined)?.id ?? null;
    console.log("[DEBUG] Senior resolved seniorId:", id);
    setSeniorId(id);

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

    // Fetch local city weather
    fetch("/api/weather?city=beijing")
      .then((r) => r.json())
      .then((d) => setWeather(d as WeatherPayload))
      .catch(() => {/* non-critical */});

    setLoading(false);
    setTimeout(() => setReady(true), 60);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Health simulator — starts once seniorId is resolved ──────
  useEffect(() => {
    if (!seniorId) return;
    const stop = startHealthSimulator(supabase, seniorId);
    return stop;
  }, [supabase, seniorId]);

  // ── Realtime: subscribe once seniorId is known ────────────────
  // Broad subscription (no server-side filter) — client-side match.
  // Re-runs whenever seniorId changes (initially null → then real id).
  useEffect(() => {
    if (!seniorId) return;

    let channel = supabase
      .channel("senior-home-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: RealtimePostgresInsertPayload<MessageRow>) => {
          const incoming = payload.new;
          // Only care about carer text messages for THIS senior
          if (
            incoming.senior_id  !== seniorId ||
            incoming.sender_role !== "carer"  ||
            incoming.type        !== "text"
          ) return;

          console.log("[senior-realtime] new carer message:", incoming.id);
          setLatestMsg(incoming);
          setMsgIsNew(true);
          setTimeout(() => setMsgIsNew(false), 1400);
        },
      )
      .subscribe((status) => {
        console.log("[senior-realtime] channel status:", status);
      });

    // ── Keep-alive for mobile browsers ───────────────────────────
    // Xiaomi / Android Chrome suspends WebSocket when screen dims.
    // On visibilitychange → visible, tear down stale channel and
    // re-subscribe, then re-fetch in case we missed messages.
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      console.log("[senior-realtime] page visible — resubscribing");
      supabase.removeChannel(channel);
      channel = supabase
        .channel("senior-home-messages-revival")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload: RealtimePostgresInsertPayload<MessageRow>) => {
            const incoming = payload.new;
            if (
              incoming.senior_id  !== seniorId ||
              incoming.sender_role !== "carer"  ||
              incoming.type        !== "text"
            ) return;
            console.log("[senior-realtime] new carer message (revival):", incoming.id);
            setLatestMsg(incoming);
            setMsgIsNew(true);
            setTimeout(() => setMsgIsNew(false), 1400);
          },
        )
        .subscribe((status) => {
          console.log("[senior-realtime] revival channel:", status);
        });

      // Also re-fetch to catch any messages missed while suspended
      supabase
        .from("messages")
        .select("*")
        .eq("senior_id", seniorId)
        .eq("type", "text")
        .eq("sender_role", "carer")
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => {
          const latest = (data as MessageRow[] | null)?.[0] ?? null;
          if (latest) {
            setLatestMsg((prev) =>
              !prev || latest.created_at > prev.created_at ? latest : prev,
            );
          }
        });
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      supabase.removeChannel(channel);
    };
  }, [supabase, seniorId]);

  // ── Mark message as read ──────────────────────────────────────
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

  // ── Loading ───────────────────────────────────────────────────
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

  // ── Main ──────────────────────────────────────────────────────
  return (
    <main
      className={[
        "min-h-screen bg-stone-50",
        "flex flex-col items-center justify-center gap-8",
        "transition-opacity duration-500 ease-out px-6",
        ready ? "opacity-100" : "opacity-0",
      ].join(" ")}
    >
      {/* ── 当前城市天气 ── */}
      {weather && (
        <div className="w-full max-w-xs rounded-3xl bg-white border border-slate-100 shadow-sm px-5 py-4 flex items-center justify-between">
          <p className="text-slate-700 font-semibold text-base">当前城市天气</p>
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-slate-700 text-sm font-medium">
              当前气温: {weather.temp_c}°C
            </span>
            <span className="text-slate-400 text-xs">
              气温 {weather.temp_min}–{weather.temp_max}°C · {weather.text}
            </span>
          </div>
        </div>
      )}

      <MessageBanner
        message={latestMsg}
        isNew={msgIsNew}
        onMarkRead={handleMarkRead}
      />

      <PeaceButton
        seniorId={seniorId}
        carerName="小杰"
      />

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <VoiceRecorder seniorId={seniorId} />
        <QuickRequest  seniorId={seniorId} />
      </div>
    </main>
  );
}
