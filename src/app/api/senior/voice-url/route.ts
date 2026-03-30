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
