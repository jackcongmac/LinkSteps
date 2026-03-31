/**
 * Auth middleware — session refresh + route protection.
 *
 * Protected routes (require auth):  /log, /dashboard, ...
 * Public routes (no auth needed):   /login, /auth/callback
 *
 * Flow:
 *   1. Refresh the Supabase session on every request (keeps cookies up-to-date)
 *   2. If the user is not authenticated and trying to reach a protected route
 *      → redirect to /login
 *   3. If the user is already authenticated and trying to reach /login
 *      → redirect to /log (avoids showing login screen when already signed in)
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Routes that require a valid session
const PROTECTED_PREFIXES = ['/log', '/insights', '/dashboard', '/settings', '/senior-home', '/carer'];

// Routes that are only for unauthenticated users
const AUTH_ONLY_ROUTES = ['/login'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Hard pass-through for public routes ─────────────────────
  // /login and /auth/* must never be intercepted — doing so causes
  // ERR_TOO_MANY_REDIRECTS because the redirect chain loops back here.
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) {
    return NextResponse.next();
  }

  const response = NextResponse.next({ request });

  // Create a Supabase client that can read/write cookies on the response
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session — this is the canonical Supabase SSR middleware pattern.
  // getUser() re-validates the JWT with the Supabase auth server and rotates
  // the refresh token when needed. It is safe to call on every request.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users away from protected routes
  if (!user && PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    // Preserve full destination (path + query string) so invite URLs survive login.
    // e.g. /settings?role=teacher → after login user lands on /settings?role=teacher
    const search = request.nextUrl.search;
    loginUrl.searchParams.set('next', search ? `${pathname}${search}` : pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from login page — honour ?next= if present
  if (user && AUTH_ONLY_ROUTES.some((p) => pathname.startsWith(p))) {
    const next = request.nextUrl.searchParams.get('next');
    const appUrl = request.nextUrl.clone();
    if (next && next.startsWith('/')) {
      // next may be a path+query string like "/settings?role=teacher"
      const [nextPath, nextQuery] = next.split('?');
      appUrl.pathname = nextPath;
      appUrl.search = nextQuery ? `?${nextQuery}` : '';
    } else {
      // No ?next= — send to root, which will role-route to the right page
      appUrl.pathname = '/';
      appUrl.search = '';
    }
    return NextResponse.redirect(appUrl);
  }

  return response;
}

export const config = {
  /*
   * Match all routes EXCEPT:
   *   - Next.js internals (_next/static, _next/image)
   *   - favicon
   *   - /auth/callback (must be publicly accessible for Magic Link / PKCE flow)
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/callback).*)',
  ],
};
