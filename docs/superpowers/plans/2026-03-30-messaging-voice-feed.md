# Messaging, Voice Memo & Family Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bidirectional communication between carer (Jack) and senior (妈妈) — text messages, voice memos, TTS playback, is_read status, and a unified Family Timeline replacing the existing checkins-only timeline.

**Architecture:** New `messages` table stores both text (carer→senior) and voice (senior→carer) entries. Senior screen gets a `MessageBanner` (tap-to-TTS, auto-marks read after 3s) and a `VoiceRecorder`. Carer screen gets a `ComposeMessage` input and a `FamilyTimeline` that merges checkins + messages in one chronological feed.

**Tech Stack:** Next.js 15 App Router, Supabase (Auth + Database + Realtime + Storage), Tailwind CSS v4, Web Speech API (SpeechSynthesis), MediaRecorder API, TypeScript strict mode.

---

## File Map

| Status | File | Purpose |
|--------|------|---------|
| CREATE | `supabase/migrations/20260330_messages.sql` | messages table + RLS + realtime |
| CREATE | `src/types/messages.ts` | MessageRow + FeedItem shared types |
| CREATE | `src/app/api/senior/voice-url/route.ts` | GET signed Storage URL for audio playback |
| CREATE | `src/components/senior/senior/MessageBanner.tsx` | Latest carer message + tap-to-TTS + HeartBurst + is_read |
| CREATE | `src/components/senior/senior/VoiceRecorder.tsx` | Record audio + upload to Storage + insert message row |
| CREATE | `src/components/senior/carer/ComposeMessage.tsx` | Text input + send button with confetti |
| CREATE | `src/components/senior/carer/FamilyTimeline.tsx` | Unified checkins + messages feed |
| MODIFY | `src/app/globals.css` | Add `heartFloat` + `confettiBurst` keyframes |
| MODIFY | `src/app/senior-home/page.tsx` | Wire MessageBanner + VoiceRecorder + Realtime + is_read |
| MODIFY | `src/app/carer/page.tsx` | Wire ComposeMessage + FamilyTimeline + Realtime messages |

**Deprecated (do not delete yet):** `src/components/senior/carer/CheckinTimeline.tsx` — kept until FamilyTimeline is confirmed working in production.

---

## Task 1: DB Migration — messages table

**Files:**
- Create: `supabase/migrations/20260330_messages.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260330_messages.sql
-- ============================================================
-- LinkSteps — Messages Table
-- Stores text messages (carer→senior) and voice memos (senior→carer)
-- ============================================================

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id        uuid NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL REFERENCES auth.users(id),
  sender_role      text NOT NULL CHECK (sender_role IN ('carer', 'senior')),
  type             text NOT NULL CHECK (type IN ('text', 'voice')),
  content          text,
  audio_url        text,
  audio_mime_type  text,
  is_read          boolean NOT NULL DEFAULT false,
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_content_check CHECK (
    (type = 'text'  AND content   IS NOT NULL AND audio_url IS NULL)
    OR
    (type = 'voice' AND audio_url IS NOT NULL AND content   IS NULL)
  )
);

CREATE INDEX messages_senior_time ON messages (senior_id, created_at DESC);

-- REPLICA IDENTITY FULL is required so Realtime UPDATE payloads include all columns
-- (default REPLICA IDENTITY DEFAULT only includes the primary key).
-- Without this, payload.new.senior_id is undefined and the carer-side filter breaks.
ALTER TABLE messages REPLICA IDENTITY FULL;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Carers and senior (Phase 1: same account) can read all messages for their senior
CREATE POLICY "messages: carers can read"
  ON messages FOR SELECT
  USING (
    senior_id IN (SELECT id FROM senior_profiles WHERE created_by = auth.uid())
    OR
    senior_id IN (SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid())
  );

-- Senior can mark messages as read (UPDATE is_read + read_at only)
CREATE POLICY "messages: senior can mark read"
  ON messages FOR UPDATE
  USING (
    senior_id IN (SELECT id FROM senior_profiles WHERE created_by = auth.uid())
  )
  WITH CHECK (
    senior_id IN (SELECT id FROM senior_profiles WHERE created_by = auth.uid())
  );

-- Sender can insert messages for seniors they are linked to
CREATE POLICY "messages: sender can insert"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      senior_id IN (SELECT id FROM senior_profiles WHERE created_by = auth.uid())
      OR senior_id IN (SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid())
    )
  );

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
```

- [ ] **Step 2: Run the SQL in Supabase Dashboard**

Go to Supabase Dashboard → SQL Editor → paste and run the file above.

Expected: "Success. No rows returned."

- [ ] **Step 3: Create the voice-memos Storage bucket**

In Supabase Dashboard → Storage → New bucket:
- Name: `voice-memos`
- Public: **OFF** (private)
- Click "Create bucket"

Then add bucket policies (Storage → voice-memos → Policies → New policy):

**Upload policy** (INSERT):
```sql
-- Allow authenticated users to upload to their own senior's folder
((bucket_id = 'voice-memos') AND (auth.role() = 'authenticated'))
```

**Download policy** (SELECT) — leave empty. Downloads go through the signed-URL API route only.

- [ ] **Step 4: Verify**

In Supabase Dashboard → Table Editor → `messages` table should exist with all columns.
In Storage → `voice-memos` bucket should exist and be private.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260330_messages.sql
git commit -m "feat: messages table + RLS + voice-memos storage bucket"
```

---

## Task 2: Shared Types

**Files:**
- Create: `src/types/messages.ts`

- [ ] **Step 1: Create the types file**

```ts
// src/types/messages.ts

export interface MessageRow {
  id:              string;
  senior_id:       string;
  sender_id:       string;
  sender_role:     'carer' | 'senior';
  type:            'text' | 'voice';
  content:         string | null;
  audio_url:       string | null;
  audio_mime_type: string | null;
  is_read:         boolean;
  read_at:         string | null;
  created_at:      string;
}

export type FeedItem =
  | { kind: 'checkin'; id: string; created_at: string }
  | { kind: 'text';    id: string; created_at: string; content: string; sender_role: 'carer' | 'senior'; is_read: boolean }
  | { kind: 'voice';   id: string; created_at: string; audio_url: string; audio_mime_type: string | null; sender_role: 'carer' | 'senior' };

/** Merge checkins + messages into one sorted feed (newest first) */
export function buildFeed(
  checkins: { id: string; checked_in_at: string }[],
  messages: MessageRow[],
): FeedItem[] {
  const items: FeedItem[] = [
    ...checkins.map((c) => ({
      kind: 'checkin' as const,
      id: c.id,
      created_at: c.checked_in_at,
    })),
    ...messages.map((m): FeedItem =>
      m.type === 'voice'
        ? {
            kind: 'voice',
            id: m.id,
            created_at: m.created_at,
            audio_url: m.audio_url!,
            audio_mime_type: m.audio_mime_type,
            sender_role: m.sender_role,
          }
        : {
            kind: 'text',
            id: m.id,
            created_at: m.created_at,
            content: m.content!,
            sender_role: m.sender_role,
            is_read: m.is_read,
          },
    ),
  ];
  return items.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/jackcong/Desktop/linksteps && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/messages.ts
git commit -m "feat: MessageRow + FeedItem shared types + buildFeed util"
```

---

## Task 3: CSS Keyframes

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add `heartFloat` and `confettiBurst` keyframes**

Append to the end of `src/app/globals.css`:

```css
/* Messages — heart particles float up from MessageBanner */
@keyframes heartFloat {
  0%   { opacity: 1; transform: translateY(0)    scale(1);   }
  100% { opacity: 0; transform: translateY(-60px) scale(1.4); }
}

/* ComposeMessage — send button flash on success */
@keyframes confettiBurst {
  0%   { transform: scale(1);    }
  40%  { transform: scale(1.18); }
  100% { transform: scale(1);    }
}
```

- [ ] **Step 2: Verify dev server still compiles**

```bash
npm run dev
```

Expected: no CSS errors in terminal.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: heartFloat + confettiBurst CSS keyframes"
```

---

## Task 4: API Route — Signed Voice URL

**Files:**
- Create: `src/app/api/senior/voice-url/route.ts`

> **Context:** Follows the same `createServerClient` pattern as `/api/senior/checkin/route.ts`. Returns a 5-minute signed URL for audio playback. Never exposes the raw Storage path to the client.

- [ ] **Step 1: Create the route**

```ts
// src/app/api/senior/voice-url/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET(req: NextRequest) {
  const messageId = req.nextUrl.searchParams.get("messageId");
  if (!messageId) {
    return NextResponse.json({ error: "missing messageId" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server component — cookie mutation silently ignored
          }
        },
      },
    },
  );

  // Auth check
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch message — RLS ensures caller has access
  const { data: msg, error: msgError } = await supabase
    .from("messages")
    .select("audio_url, audio_mime_type")
    .eq("id", messageId)
    .eq("type", "voice")
    .single();

  if (msgError || !msg?.audio_url) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Generate signed URL (5-minute expiry)
  const { data: signed, error: storageError } = await supabase.storage
    .from("voice-memos")
    .createSignedUrl(msg.audio_url as string, 300);

  if (storageError || !signed) {
    console.error("[voice-url] storage error:", storageError?.message);
    return NextResponse.json({ error: "storage error" }, { status: 500 });
  }

  return NextResponse.json({
    url:      signed.signedUrl,
    mimeType: msg.audio_mime_type ?? "audio/webm",
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual test**

With the dev server running (`npm run dev`), open the browser console on any authenticated page and run:

```js
fetch('/api/senior/voice-url?messageId=nonexistent').then(r => r.json()).then(console.log)
```

Expected: `{ error: "not found" }` (404) — confirms the route is wired and auth works.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/senior/voice-url/route.ts
git commit -m "feat: GET /api/senior/voice-url — signed Storage URL for audio playback"
```

---

## Task 5: MessageBanner Component

**Files:**
- Create: `src/components/senior/senior/MessageBanner.tsx`

> **Context:** Shown above the PeaceButton on the senior home screen. Displays the latest text message from the carer. Tapping the bubble OR the 🔊 icon triggers TTS. When `isNew=true`, 5 heart particles animate upward. Auto-marks the message as read after 3 seconds of visibility via `onMarkRead` callback.

- [ ] **Step 1: Create the component**

```tsx
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
    window.speechSynthesis.cancel(); // stop any in-progress speech
    const utt = new SpeechSynthesisUtterance(message.content);
    utt.lang = "zh-CN";
    utt.rate = 0.88; // slightly slower for elderly listener
    window.speechSynthesis.speak(utt);
  }

  return (
    <div className="relative w-full max-w-xs">

      {/* ── HeartBurst — inlined keyframe animation ── */}
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

      {/* ── Message bubble — tappable for TTS ── */}
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/senior/senior/MessageBanner.tsx
git commit -m "feat: MessageBanner — tap-to-TTS, HeartBurst animation, auto-mark read"
```

---

## Task 6: VoiceRecorder Component

**Files:**
- Create: `src/components/senior/senior/VoiceRecorder.tsx`

> **Context:** Shown below the PeaceButton. Senior taps to start recording (max 60s), taps again to stop. Audio uploads to Supabase Storage, then a voice message row is inserted. Senior always sees "已发送 ✅" — never sees errors (same resilience rule as PeaceButton).

- [ ] **Step 1: Create the component**

```tsx
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
  // useMemo ensures a stable client reference — avoids re-creating on every render
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
        return; // message row not inserted — known MVP gap, logged above
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

    // Tick counter; auto-stop at 60s
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

  // ── Render ────────────────────────────────────────────────

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

  // uploading + done share same UI (senior sees success immediately)
  return (
    <div className="flex items-center gap-2 px-5 py-3 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-600 text-base">
      {recState === "uploading"
        ? <span className="w-4 h-4 rounded-full border-2 border-emerald-300 border-t-emerald-600 animate-spin" />
        : "✅"}
      {recState === "uploading" ? "发送中…" : "已发送"}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/senior/senior/VoiceRecorder.tsx
git commit -m "feat: VoiceRecorder — record + upload to Storage + insert voice message"
```

---

## Task 7: Wire senior-home/page.tsx

**Files:**
- Modify: `src/app/senior-home/page.tsx`

> **Context:** Add loading of latest carer message, Realtime subscription on `messages`, `onMarkRead` handler that calls `.update({ is_read: true, read_at })`, and render `MessageBanner` above + `VoiceRecorder` below the `PeaceButton`. Also set `PREVIEW_MODE = false`.

- [ ] **Step 1: Replace the full file**

```tsx
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
          setTimeout(() => setMsgIsNew(false), 1400); // after HeartBurst finishes
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Open `http://localhost:3000/senior-home`. Verify:
- "Jack 还没有留言" placeholder card appears above the peace button
- "🎙 发语音给 Jack" button appears below

- [ ] **Step 4: Commit**

```bash
git add src/app/senior-home/page.tsx
git commit -m "feat: senior-home — MessageBanner + VoiceRecorder + is_read handler"
```

---

## Task 8: ComposeMessage Component

**Files:**
- Create: `src/components/senior/carer/ComposeMessage.tsx`

> **Context:** Single-line input + send button in the carer dashboard. On success: input clears and button flashes with `confettiBurst`. Shows inline error text if send fails (carer can read errors, unlike senior). Max 100 characters enforced by disabling the send button.

- [ ] **Step 1: Create the component**

```tsx
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
  // Stable client reference — never recreated on re-render
  const supabase = useMemo(() => createClient(), []);

  const send = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !seniorId || sending) return;
    setSending(true);
    setErr(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSending(false); setErr("请先登录"); return; }

    const { error } = await supabase.from("messages").insert({
      senior_id:   seniorId,
      sender_id:   user.id,
      sender_role: "carer",
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/senior/carer/ComposeMessage.tsx
git commit -m "feat: ComposeMessage — text input + send with confetti flash"
```

---

## Task 9: FamilyTimeline Component

**Files:**
- Create: `src/components/senior/carer/FamilyTimeline.tsx`

> **Context:** Replaces `CheckinTimeline` in the carer dashboard. Renders checkins (💚), carer text messages (💬), and senior voice memos (🎙). Voice items show a play button that fetches a signed URL from `/api/senior/voice-url` and plays via an `<audio>` element. Carer text messages show "已读" badge when `is_read=true`.

- [ ] **Step 1: Create the component**

```tsx
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

// ── VoicePlayButton ─────────────────────────────────────────

interface VoicePlayButtonProps {
  messageId: string;
}

function VoicePlayButton({ messageId }: VoicePlayButtonProps) {
  const [loading,  setLoading]  = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing,  setPlaying]  = useState(false);
  // useRef avoids getElementById + setTimeout anti-pattern
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
    // audioRef.current will be populated after state update re-render
    // Play is triggered by the useEffect below
  }, [messageId, loading, audioUrl]);

  // Auto-play once the audio element is rendered with the new src
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

// ── FamilyTimeline ───────────────────────────────────────────

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
            {/* Vertical line */}
            {i < items.length - 1 && (
              <div className="absolute left-[9px] top-5 bottom-0 w-px bg-slate-100" />
            )}

            {/* Dot */}
            <div
              className={[
                "relative z-10 mt-1 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px]",
                isFirst ? "bg-emerald-500 ring-4 ring-emerald-100" : "bg-slate-200",
              ].join(" ")}
            >
              {isFirst && <div className="w-2 h-2 rounded-full bg-white" />}
            </div>

            {/* Content */}
            <div className="flex flex-col gap-1 pt-0.5 flex-1 min-w-0">

              {/* ── Checkin ── */}
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

              {/* ── Text message ── */}
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

              {/* ── Voice memo ── */}
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

            </div>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/senior/carer/FamilyTimeline.tsx
git commit -m "feat: FamilyTimeline — unified checkins + text + voice feed with playback"
```

---

## Task 10: Wire carer/page.tsx

**Files:**
- Modify: `src/app/carer/page.tsx`

> **Context:** Add messages loading (initial fetch + Realtime INSERT + UPDATE for is_read), render `ComposeMessage` above the timeline, replace `<CheckinTimeline>` with `<FamilyTimeline>`. The `buildFeed` util from `src/types/messages.ts` handles merging.

- [ ] **Step 1: Replace the relevant sections**

In `src/app/carer/page.tsx`:

**Add imports** (after existing imports):
```tsx
import ComposeMessage from "@/components/senior/carer/ComposeMessage";
import FamilyTimeline from "@/components/senior/carer/FamilyTimeline";
import type { MessageRow } from "@/types/messages";
import { buildFeed } from "@/types/messages";
import type { FeedItem } from "@/types/messages";
```

**Add state** (inside `CarerDashboard`, after existing state declarations):
```tsx
const [messages, setMessages] = useState<MessageRow[]>([]);
const [feed,     setFeed]     = useState<FeedItem[]>([]);
```

**Update feed whenever checkins or messages change** (add new useEffect after existing ones):
```tsx
useEffect(() => {
  setFeed(buildFeed(checkins, messages));
}, [checkins, messages]);
```

**Add messages fetch inside `loadData`** (after the checkins fetch block, still inside `if (id)`):
```tsx
const { data: msgRows, error: messagesError } = await supabase
  .from("messages")
  .select("*")
  .eq("senior_id", id)
  .order("created_at", { ascending: false })
  .limit(40);

if (messagesError) {
  console.error("[carer] messages query failed:", messagesError.message);
}

setMessages((msgRows as MessageRow[]) ?? []);
```

**Replace the entire existing Realtime `useEffect`** (currently at lines 247–279 of `carer/page.tsx`) with this complete block. Do not add `.on()` calls incrementally — replace the whole `useEffect` to avoid channel name collisions and missing cleanup.

Add this import at the top of the file:
```tsx
import type { RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
```

Then replace the Realtime `useEffect`:
```tsx
useEffect(() => {
  const channel = supabase
    .channel("carer-dashboard")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "checkins" },
      (payload: RealtimePostgresInsertPayload<CheckinRow>) => {
        const incoming = payload.new;
        if (
          seniorIdRef.current &&
          (incoming as CheckinRow & { senior_id?: string }).senior_id !== seniorIdRef.current
        ) return;

        setCheckins((prev) => [
          { ...incoming, isNew: true },
          ...prev.slice(0, 19),
        ]);
        setPulse(true);

        setTimeout(() => {
          setCheckins((prev) =>
            prev.map((c, i) => (i === 0 ? { ...c, isNew: false } : c)),
          );
        }, 500);
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload: RealtimePostgresInsertPayload<MessageRow>) => {
        const incoming = payload.new;
        if (incoming.senior_id !== seniorIdRef.current) return;
        setMessages((prev) => [incoming, ...prev.slice(0, 39)]);
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages" },
      // RealtimePostgresUpdatePayload requires REPLICA IDENTITY FULL on the table
      // (added in migration) so payload.new contains all columns, not just PK.
      (payload: RealtimePostgresUpdatePayload<MessageRow>) => {
        const updated = payload.new;
        if (updated.senior_id !== seniorIdRef.current) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
        );
      },
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}, [supabase]);
```

**Replace `<CheckinTimeline>` with `<ComposeMessage>` + `<FamilyTimeline>`** in the JSX (inside the "最近动态" card):

Replace:
```tsx
<CheckinTimeline entries={checkins} />
```

With:
```tsx
<ComposeMessage seniorId={seniorId} />
<div className="mt-4">
  <FamilyTimeline items={feed} />
</div>
```

Remove the `CheckinTimeline` import line (keep the file itself — just stop importing it).

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Open `http://localhost:3000/carer`. Verify:
- "给妈妈发条消息…" input appears in the 最近动态 card
- Existing checkin entries still show in the timeline (now via FamilyTimeline)

- [ ] **Step 4: End-to-end test**

1. Open `http://localhost:3000/carer` (Jack's view)
2. Type "妈妈早上好，今天天气不错" and press Enter
3. Button flashes ✅ 已发
4. Message appears in the timeline as "💬 你发了一条消息"
5. Open `http://localhost:3000/senior-home` on another tab/phone
6. MessageBanner shows the message text
7. Tap the bubble → Chinese TTS plays
8. Wait 3 seconds → switch back to carer view → message shows "已读" badge

- [ ] **Step 5: Test voice memo flow**

1. On senior-home, tap "🎙 发语音给 Jack"
2. Allow microphone, speak for 3 seconds, tap "点击停止"
3. Shows "已发送 ✅"
4. On carer dashboard → "🎙 妈妈发来一段语音" appears in timeline
5. Tap ▶ → audio plays

- [ ] **Step 6: Commit**

```bash
git add src/app/carer/page.tsx
git commit -m "feat: carer dashboard — ComposeMessage + FamilyTimeline + messages Realtime"
```

---

## Task 11: Final Cleanup

**Files:**
- Verify: all files above

- [ ] **Step 1: Confirm PREVIEW_MODE is already false**

In `src/app/senior-home/page.tsx` — the rewritten file in Task 7 no longer has `PREVIEW_MODE`. Confirm the file does not contain the string:

```bash
grep -n "PREVIEW_MODE" src/app/senior-home/page.tsx
```

Expected: no output (the rewrite removed it).

- [ ] **Step 2: Run full TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Check dev server for runtime errors**

```bash
npm run dev
```

Open browser dev tools — no red errors in console on either `/senior-home` or `/carer`.

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete messaging + voice memo + family timeline feature"
```

---

## Testing Checklist (full regression)

- [ ] Carer sends text → senior-home MessageBanner updates in real time
- [ ] Tap message bubble on senior-home → Chinese TTS plays (zh-CN, rate 0.88)
- [ ] TTS button not shown if `speechSynthesis` unavailable
- [ ] Message on senior-home for 3s → is_read=true → carer sees "已读" badge
- [ ] Senior taps 🎙 → microphone permission prompt → records → stops → "已发送 ✅"
- [ ] Voice memo appears in carer FamilyTimeline → ▶ plays audio
- [ ] iOS: audio format is `audio/mp4` (not webm) — verify `audio_mime_type` column in Supabase
- [ ] FamilyTimeline shows checkins + messages merged in correct chronological order
- [ ] ComposeMessage: 100-char limit disables send button; no visible counter
- [ ] HeartBurst: 5 hearts animate upward when new carer message arrives on senior-home
- [ ] confettiBurst: send button flashes on successful send in carer view
