import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Root page — role-based redirect.
 *
 *   senior  → /senior-home  (平安扣长辈端)
 *   carer   → /carer        (平安扣晚辈端)
 *   others  → /log          (Child session)
 *
 * Unauthenticated users land here after logout — redirect to /login.
 */
export default async function RootPage() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = (profile as { role?: string } | null)?.role ?? "";

  if (role === "senior") redirect("/senior-home");
  if (role === "carer")  redirect("/carer");
  redirect("/log");
}
