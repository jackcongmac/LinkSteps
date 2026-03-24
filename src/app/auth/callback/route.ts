/**
 * /auth/callback — Magic Link session handler
 *
 * Supabase sends the user here after they click the email link.
 * The URL contains a `code` param (PKCE flow) that must be exchanged
 * for a session before redirecting into the app.
 *
 * Flow:
 *   1. Extract `code` from the query string
 *   2. Exchange it for a Supabase session (sets the auth cookie)
 *   3. Redirect to `next` (default: /log) on success
 *   4. Redirect to /login?error=auth on failure
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/log';

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Session established — redirect into the app
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Missing code or exchange failure → back to login with error flag
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
