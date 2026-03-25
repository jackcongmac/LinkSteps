import { redirect } from "next/navigation";

// Root → /log.
// Unauthenticated users: middleware catches /log and sends them to /login.
// Authenticated users: middleware passes /log through to the app.
export default function RootPage() {
  redirect("/log");
}
