/**
 * POST /api/senior/checkin
 *
 * Records a 平安扣 check-in for the authenticated senior.
 *
 * Body: { seniorId: string; source?: 'button' | 'auto_active' }
 *
 * Response: { checked_in_at: string }
 *
 * Security:
 *  - Requires authenticated session (Supabase Auth)
 *  - The RLS policy on `checkins` ensures the user can only
 *    insert rows where senior_id.created_by = auth.uid()
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
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

  // Verify authentication
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse body
  const body = (await req.json().catch(() => ({}))) as {
    seniorId?: string;
    source?: string;
  };

  const source =
    body.source === "auto_active" ? "auto_active" : "button";

  // Resolve seniorId — either from body or look up by created_by
  let seniorId = body.seniorId ?? null;

  if (!seniorId) {
    const { data: profile } = await supabase
      .from("senior_profiles")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Senior profile not found" }, { status: 404 });
    }
    seniorId = profile.id as string;
  }

  // Insert check-in (RLS will reject if user doesn't own this senior_id)
  const { data, error } = await supabase
    .from("checkins")
    .insert({ senior_id: seniorId, source })
    .select("checked_in_at")
    .single();

  if (error) {
    console.error("[checkin] insert error:", error.message);
    return NextResponse.json({ error: "Failed to record check-in" }, { status: 500 });
  }

  return NextResponse.json({ checked_in_at: (data as { checked_in_at: string }).checked_in_at });
}
