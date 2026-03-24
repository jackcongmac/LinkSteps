/**
 * Supabase client — server (Server Component / Route Handler / Server Action) version
 *
 * Usage:
 *   import { createServerClient } from '@/lib/supabase-server'
 *   const supabase = await createServerClient()
 */
import { createServerClient as _createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createServerClient() {
  const cookieStore = await cookies();

  return _createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll can be called from a Server Component where cookies
            // cannot be modified — this is safe to ignore when the middleware
            // has already refreshed the session.
          }
        },
      },
    },
  );
}
