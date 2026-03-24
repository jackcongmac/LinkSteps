/**
 * Supabase client — browser (Client Component) version
 *
 * Usage:
 *   import { supabase } from '@/lib/supabase'
 */
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
