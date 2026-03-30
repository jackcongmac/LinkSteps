// src/components/senior/senior/VoiceRecorder.tsx
"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase";

type RecorderState = "idle" | "recording" | "uploading" | "done";

interface Props {
  seniorId: string | null;
}

export default function VoiceRecorder({ seniorId }: Props) {
  const [recState, setRecState] = useState<RecorderState>("idle");
  const [seconds,  setSeconds]  = useState(0);
  const mediaRef   = useRef<MediaRecorder | null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const supabase   = useMemo(() => createClient(), []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRef.current?.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (!seniorId) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      console.error("[VoiceRecorder] microphone access denied");
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/mp4";

    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());

      // Show success immediately — senior never waits on network
      setRecState("done");
      setTimeout(() => { setRecState("idle"); setSeconds(0); }, 3000);

      const blob      = new Blob(chunksRef.current, { type: mimeType });
      const ext       = mimeType.includes("webm") ? "webm" : "mp4";
      const messageId = crypto.randomUUID();
      const path      = `${seniorId}/${messageId}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("voice-memos")
        .upload(path, blob, { contentType: mimeType });

      if (uploadError) {
        console.error("[VoiceRecorder] upload failed:", uploadError.message);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error: insertError } = await supabase.from("messages").insert({
        id:              messageId,
        senior_id:       seniorId,
        sender_id:       user.id,
        sender_role:     "senior",
        type:            "voice",
        audio_url:       path,
        audio_mime_type: mimeType,
      });

      if (insertError) {
        console.error("[VoiceRecorder] insert failed:", insertError.message);
      }
    };

    recorder.start();
    mediaRef.current = recorder;
    setRecState("recording");
    setSeconds(0);

    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= 60) {
          stopRecording();
          return 60;
        }
        return s + 1;
      });
    }, 1000);
  }, [seniorId, supabase, stopRecording]);

  if (recState === "idle") {
    return (
      <button
        onClick={startRecording}
        disabled={!seniorId}
        className="flex items-center gap-2 px-5 py-3 rounded-full bg-white border border-slate-200 text-slate-600 text-base active:scale-95 transition-transform disabled:opacity-40"
      >
        🎙 发语音给 Jack
      </button>
    );
  }

  if (recState === "recording") {
    return (
      <button
        onClick={stopRecording}
        className="flex items-center gap-3 px-5 py-3 rounded-full bg-red-50 border border-red-200 text-red-600 text-base active:scale-95 transition-transform"
      >
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        {seconds}秒 · 点击停止
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 px-5 py-3 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-600 text-base">
      {recState === "uploading"
        ? <span className="w-4 h-4 rounded-full border-2 border-emerald-300 border-t-emerald-600 animate-spin" />
        : "✅"}
      {recState === "uploading" ? "发送中…" : "已发送"}
    </div>
  );
}
