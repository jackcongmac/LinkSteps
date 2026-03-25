"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Copy, Check, Lock } from "lucide-react";
import { getProfile, upsertProfile, getFirstName, grantSelfAdmin } from "@/lib/mood-log";
import type { UserProfile } from "@/lib/mood-log";
import AppNav from "@/components/ui/app-nav";

// ── Age display helper ───────────────────────────────────────

/** Maps age to a short developmental stage label shown below the birthday. */
function devStageLabel(birthday: string): string {
  const bday = new Date(`${birthday}T12:00:00`);
  if (isNaN(bday.getTime())) return "";
  const today = new Date();
  let age = today.getFullYear() - bday.getFullYear();
  const m = today.getMonth() - bday.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bday.getDate())) age--;
  if (age < 0) return "";
  if (age < 4)  return "Toddler — predictability is key";
  if (age < 6)  return "Preschool — short, clear routines";
  if (age < 10) return "Early school age — structured transitions help most";
  if (age < 13) return "Pre-teen — peer dynamics matter";
  return "Teenager — autonomy & validation";
}

// ── Role options ─────────────────────────────────────────────

const ROLES: { value: UserProfile["role"]; label: string; icon: string }[] = [
  { value: "parent",    label: "Parent",    icon: "🏠" },
  { value: "teacher",   label: "Teacher",   icon: "🎒" },
  { value: "therapist", label: "Therapist", icon: "🧩" },
];

// ── Seat quota config ────────────────────────────────────────
//
// MVP: counts are static (current user = 1 used in their own role).
// Replace usedCounts with a real DB query once profiles table is live.

const QUOTAS: { role: UserProfile["role"]; icon: string; label: string; total: number }[] = [
  { role: "parent",    icon: "🏠", label: "Parents",    total: 4 },
  { role: "teacher",   icon: "🎒", label: "Teachers",   total: 4 },
  { role: "therapist", icon: "🧩", label: "Therapists", total: 3 },
];

function SeatDots({ used, total }: { used: number; total: number }) {
  return (
    <div className="flex gap-1" aria-label={`${used} of ${total} seats used`}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${
            i < used ? "bg-sky-400" : "bg-slate-200"
          }`}
        />
      ))}
    </div>
  );
}

// ── Inner component (reads searchParams) ─────────────────────

// ── Age window constants (sliding, recalculated each render) ──
// Supports ages 0–22. Both bounds auto-advance every calendar year.
const MAX_AGE = 22;

// ── Owner bypass ─────────────────────────────────────────────
// Emergency fallback: if the DB migration has not yet run (is_owner column
// missing) the account with this email is always treated as owner.
// Replace with your Supabase login email.
const OWNER_EMAIL = "jackcongus@gmail.com";

function SettingsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Sliding date-range window — recalculated on every render so the
  // limits advance automatically on New Year without any code change.
  const currentYear = new Date().getFullYear();
  const minDate = `${currentYear - MAX_AGE}-01-01`; // e.g. 2004-01-01 in 2026
  const maxDate = `${currentYear}-12-31`;            // e.g. 2026-12-31 in 2026

  // If an invite link was used, the role is pre-set and locked.
  const inviteRole = searchParams.get("role") as UserProfile["role"] | null;
  const isRoleLocked = ROLES.some((r) => r.value === inviteRole);

  const [profile, setProfile] = useState<UserProfile>({
    display_name: "",
    role: isRoleLocked ? inviteRole! : "parent",
    child_name: "",
    child_birthday: undefined,
  });
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState<string | null>(null);
  const [toastOk, setToastOk]       = useState(true);
  const [birthdayError, setBirthdayError] = useState<string | null>(null);
  const [userEmail, setUserEmail]   = useState<string | null>(null);
  // Per-role "Copied!" state for invite buttons
  const [copiedRole, setCopiedRole] = useState<UserProfile["role"] | null>(null);
  // Popover: which role's config panel is open (parent only), + checkbox state
  const [popoverRole, setPopoverRole] = useState<UserProfile["role"] | null>(null);
  const [grantAdminInPopover, setGrantAdminInPopover] = useState(true);

  // Load profile + auth email on mount.
  // Birthday is sanitised: corrupt values (e.g. "0019-…") are cleared.
  useEffect(() => {
    import("@/lib/supabase").then(({ createClient }) => {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        setUserEmail(user?.email ?? null);
      });
    });

    getProfile().then((p) => {
      const rawBirthday = p.child_birthday;
      let safeBirthday: string | undefined = undefined;
      if (rawBirthday) {
        const y = parseInt(rawBirthday.slice(0, 4), 10);
        if (!isNaN(y) && y >= 1000) safeBirthday = rawBirthday;
      }
      setProfile({
        ...p,
        child_birthday: safeBirthday,
        // If arriving via invite link, honour the locked role
        role: isRoleLocked ? inviteRole! : p.role,
      });
      // ── Auto-grant: arrived via pre-authorised invite link ────
      // If ?grant=1 is in the URL and the user is not yet an owner, elevate them.
      if (searchParams.get("grant") === "1" && !p.is_owner) {
        grantSelfAdmin().then(() => {
          // Reload profile so is_owner=true is reflected immediately
          getProfile().then((fresh) => {
            setProfile((prev) => ({ ...prev, is_owner: fresh.is_owner }));
          });
        });
      }

      setLoading(false);
    });
  }, [isRoleLocked, inviteRole, searchParams]);

  // Owner = DB flag OR email bypass (covers the period before the migration runs).
  const isOwner = profile.is_owner === true || userEmail === OWNER_EMAIL;

  async function handleSave() {
    if (!profile.display_name.trim()) return;

    // ── Birthday validation: owner-only field, skip for non-owners ──
    setBirthdayError(null);
    if (isOwner && profile.child_birthday) {
      const y = parseInt(profile.child_birthday.slice(0, 4), 10);
      if (isNaN(y) || y < 1000 || y < currentYear - MAX_AGE || y > currentYear) {
        setBirthdayError(`Please enter a valid birthday (ages 0–${MAX_AGE} supported).`);
        return;
      }
    }

    // Non-owners only update their own identity (display_name, role).
    // Child fields are read-only for them — pass unchanged values so upsert
    // is effectively a no-op on child_name / child_birthday.
    const payload: UserProfile = isOwner
      ? profile
      : { display_name: profile.display_name, role: profile.role, child_name: profile.child_name, child_birthday: profile.child_birthday, is_owner: false };

    setSaving(true);
    const result = await upsertProfile(payload);
    setSaving(false);
    if (result.error) {
      setToastOk(false);
      setToast("Failed to save. Try again.");
    } else {
      setToastOk(true);
      setToast("Saved!");
    }
    setTimeout(() => setToast(null), 2500);
  }

  const handleInvite = useCallback(async (role: UserProfile["role"], grantAdmin = false) => {
    const url = `${window.location.origin}/settings?role=${role}${grantAdmin ? "&grant=1" : ""}`;
    const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role;
    const childName   = getFirstName(profile.child_name)   || "your child";
    const inviterName = getFirstName(profile.display_name) || "Someone";

    // Share text intentionally omits any numeric age — privacy-first.
    const shareData = {
      title: `Join ${childName}'s Support Team on LinkSteps`,
      text:  `${inviterName} invites you to join as a ${roleLabel}. Click to connect:`,
      url,
    };

    // ── Web Share API (mobile / modern browsers) ──────────────
    if (typeof navigator.share === "function" && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
        // Share sheet opened — button feedback handled by the OS; no toast needed.
        setCopiedRole(role);
        setTimeout(() => setCopiedRole(null), 2000);
        return;
      } catch (err) {
        // AbortError = user dismissed the sheet — silent.
        // Any other error falls through to clipboard fallback.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    // ── Clipboard fallback (desktop / unsupported browsers) ───
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard also unavailable — nothing we can do, skip toast.
      return;
    }
    setCopiedRole(role);
    setTimeout(() => setCopiedRole(null), 2000);
    setToastOk(true);
    setToast("Link copied! You can now paste it to WeChat.");
    setTimeout(() => setToast(null), 3000);
  }, [profile.child_name, profile.display_name]);

  // Mock used-seat counts: current user counts as 1 in their own role slot.
  // Replace with real DB query once profiles table is live.
  function usedCount(role: UserProfile["role"]): number {
    return profile.role === role ? 1 : 0;
  }

  // ── Skeleton ──────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-8 pb-24">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 animate-pulse rounded-full bg-slate-200" />
            <div className="h-5 w-24 animate-pulse rounded-full bg-slate-200" />
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 w-full animate-pulse rounded-3xl bg-slate-200" />
          ))}
        </div>
        <AppNav />
      </main>
    );
  }

  // ── Main ──────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-8 pb-24">
      <div className="w-full max-w-sm flex flex-col gap-5">

        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm active:scale-95 transition-transform"
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4 text-slate-600" />
          </button>
          <h1 className="text-lg font-semibold text-slate-800">Settings</h1>
          {isRoleLocked && (
            <span className="ml-auto flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-600">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Invited as {inviteRole}
            </span>
          )}
        </div>

        {/* ── Profile Section ─────────────────────────────── */}
        <section className="rounded-3xl bg-white px-5 py-5 shadow-sm space-y-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Profile
          </h2>

          {/* Display Name */}
          <div className="space-y-1.5">
            <label htmlFor="display-name" className="block text-sm font-medium text-slate-700">
              Your Name
            </label>
            <input
              id="display-name"
              type="text"
              value={profile.display_name}
              onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
              placeholder="e.g. Jack"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100 transition-colors"
            />
          </div>

          {/* Role selector — locked when arriving via invite URL */}
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-slate-700">Your Role</span>
            {isRoleLocked ? (
              // Locked display — role was set by the invite link
              <div className="flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                <span className="text-base" aria-hidden="true">
                  {ROLES.find((r) => r.value === inviteRole)?.icon}
                </span>
                <span className="text-sm font-medium text-sky-700">
                  {ROLES.find((r) => r.value === inviteRole)?.label}
                </span>
                <Lock className="ml-auto h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
              </div>
            ) : (
              <div className="flex gap-2" role="group" aria-label="Select your role">
                {ROLES.map(({ value, label, icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setProfile({ ...profile, role: value })}
                    aria-pressed={profile.role === value}
                    className={`flex flex-1 flex-col items-center gap-1.5 rounded-2xl border py-3 text-xs font-medium transition-all active:scale-95 ${
                      profile.role === value
                        ? "border-sky-400 bg-sky-50 text-sky-700"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                    }`}
                  >
                    <span className="text-base" aria-hidden="true">{icon}</span>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Kid's Info Section ───────────────────────────── */}
        <section className="rounded-3xl bg-white px-5 py-5 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Kid&apos;s Info
            </h2>
            {!isOwner && (
              <span className="flex items-center gap-1 text-[10px] text-slate-400">
                <Lock className="h-3 w-3" aria-hidden="true" />
                View only
              </span>
            )}
          </div>

          {/* Child's Name */}
          <div className="space-y-1.5">
            <label htmlFor="child-name" className="block text-sm font-medium text-slate-700">
              Child&apos;s Name
            </label>
            <input
              id="child-name"
              type="text"
              value={profile.child_name}
              readOnly={!isOwner}
              onChange={(e) => isOwner && setProfile({ ...profile, child_name: e.target.value })}
              placeholder={isOwner ? "e.g. Ethan" : "—"}
              className={`w-full rounded-2xl border px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 transition-colors ${
                isOwner
                  ? "bg-slate-50 border-slate-200 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
                  : "bg-slate-100 border-slate-200 cursor-not-allowed text-slate-500 outline-none"
              }`}
            />
          </div>

          {/* Birthday */}
          <div className="space-y-1.5">
            <label htmlFor="child-birthday" className="block text-sm font-medium text-slate-700">
              Birthday
            </label>
            <input
              id="child-birthday"
              type="date"
              value={profile.child_birthday ?? ""}
              readOnly={!isOwner}
              min={isOwner ? minDate : undefined}
              max={isOwner ? maxDate : undefined}
              onChange={(e) => {
                if (!isOwner) return;
                setBirthdayError(null);
                setProfile({ ...profile, child_birthday: e.target.value || undefined });
              }}
              className={`w-full rounded-2xl border px-4 py-3 text-sm text-slate-800 transition-colors ${
                !isOwner
                  ? "bg-slate-100 border-slate-200 cursor-not-allowed text-slate-500 outline-none"
                  : birthdayError
                  ? "bg-slate-50 border-rose-300 focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100"
                  : "bg-slate-50 border-slate-200 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"
              }`}
            />
            {birthdayError && (
              <p className="text-xs text-rose-500">{birthdayError}</p>
            )}
            {isOwner && !birthdayError && profile.child_birthday && (() => {
              const y = parseInt(profile.child_birthday.slice(0, 4), 10);
              if (isNaN(y) || y < 1000) return null;
              const label = devStageLabel(profile.child_birthday);
              return label ? (
                <p className="text-xs text-slate-400">{label}</p>
              ) : null;
            })()}
          </div>
        </section>

        {/* ── Team Seats Section (owner-only) ──────────────── */}
        {isOwner && (
          <>
            {/* Backdrop — dismisses any open popover on outside click */}
            {popoverRole && (
              <div
                className="fixed inset-0 z-10"
                onClick={() => setPopoverRole(null)}
                aria-hidden="true"
              />
            )}

            <section className="rounded-3xl bg-white px-5 py-5 shadow-sm space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Team Seats
              </h2>

              <div className="space-y-3">
                {QUOTAS.map(({ role, icon, label, total }) => {
                  const used = usedCount(role);
                  const isFull = used >= total;
                  const isCopied = copiedRole === role;
                  const isParent = role === "parent";

                  return (
                    <div key={role} className="relative flex items-center gap-3">
                      {/* Role label + dots */}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm" aria-hidden="true">{icon}</span>
                          <span className="text-sm font-medium text-slate-700">{label}</span>
                          <span className="text-xs text-slate-400">{used}/{total}</span>
                        </div>
                        <SeatDots used={used} total={total} />
                      </div>

                      {/* Invite button */}
                      <button
                        type="button"
                        disabled={isFull}
                        aria-label={`Invite ${label}`}
                        onClick={() => {
                          if (isFull) return;
                          if (isParent) {
                            // Parent: open config popover first
                            setPopoverRole(popoverRole === "parent" ? null : "parent");
                            setGrantAdminInPopover(true);
                          } else {
                            // Teacher / Therapist: share directly, no admin rights
                            void handleInvite(role, false);
                          }
                        }}
                        className={`flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-1.5 text-xs font-medium transition-all active:scale-95 ${
                          isFull
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : isCopied
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-sky-50 text-sky-600 hover:bg-sky-100"
                        }`}
                      >
                        {isCopied ? (
                          <><Check className="h-3 w-3" aria-hidden="true" />Copied!</>
                        ) : (
                          <><Copy className="h-3 w-3" aria-hidden="true" />{isFull ? "Full" : "Invite"}</>
                        )}
                      </button>

                      {/* Admin config popover — parent only */}
                      {isParent && popoverRole === "parent" && (
                        <div
                          className="absolute right-0 top-full z-20 mt-2 w-56 rounded-2xl border border-slate-100 bg-white p-4 shadow-lg"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <p className="mb-3 text-xs font-semibold text-slate-700">
                            Grant administrative access?
                          </p>
                          <label className="mb-4 flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={grantAdminInPopover}
                              onChange={(e) => setGrantAdminInPopover(e.target.checked)}
                              className="h-3.5 w-3.5 rounded accent-sky-500"
                            />
                            <span className="text-[11px] text-slate-500">
                              Allow editing child info &amp; inviting others
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              void handleInvite("parent", grantAdminInPopover);
                              setPopoverRole(null);
                            }}
                            className="w-full rounded-xl bg-sky-500 py-2 text-xs font-semibold text-white shadow-sm active:scale-95 transition-transform"
                          >
                            Create Link
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Share the invite link. The recipient&apos;s role will be pre-set and locked when they sign up.
              </p>
            </section>
          </>
        )}

        {/* ── Toast ───────────────────────────────────────── */}
        {toast && (
          <div
            className={`flex items-center justify-center gap-2 rounded-3xl px-4 py-3 text-sm font-medium ${
              toastOk ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
            }`}
            role="status"
            aria-live="polite"
          >
            {toastOk && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            {toast}
          </div>
        )}

        {/* ── Save Button ─────────────────────────────────── */}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !profile.display_name.trim()}
          className="w-full rounded-3xl bg-sky-500 py-4 text-sm font-semibold text-white shadow-sm active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>

      </div>

      <AppNav />
    </main>
  );
}

// ── Page export (Suspense boundary for useSearchParams) ───────

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
