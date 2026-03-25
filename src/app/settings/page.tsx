"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Copy, Check, Lock, UserMinus, ShieldCheck, ShieldOff } from "lucide-react";
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
          className={`h-2 w-2 rounded-full ${i < used ? "bg-sky-400" : "bg-slate-200"}`}
        />
      ))}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────

const MAX_AGE = 22;
const OWNER_EMAIL = "jackcongus@gmail.com";

// ── SettingsInner ─────────────────────────────────────────────

function SettingsInner() {
  const router      = useRouter();
  const searchParams = useSearchParams();

  const currentYear = new Date().getFullYear();
  const minDate = `${currentYear - MAX_AGE}-01-01`;
  const maxDate = `${currentYear}-12-31`;

  const inviteRole   = searchParams.get("role") as UserProfile["role"] | null;
  const isRoleLocked = ROLES.some((r) => r.value === inviteRole);

  const [profile, setProfile] = useState<UserProfile>({
    display_name: "",
    role: isRoleLocked ? inviteRole! : "parent",
    child_name: "",
    child_birthday: undefined,
    relation_title: "",
  });
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [toast, setToast]                 = useState<string | null>(null);
  const [toastOk, setToastOk]             = useState(true);
  const [birthdayError, setBirthdayError] = useState<string | null>(null);
  const [userEmail, setUserEmail]         = useState<string | null>(null);
  const [copiedRole, setCopiedRole]       = useState<UserProfile["role"] | null>(null);
  const [popoverRole, setPopoverRole]     = useState<UserProfile["role"] | null>(null);
  const [grantAdminInPopover, setGrantAdminInPopover] = useState(true);

  useEffect(() => {
    import("@/lib/supabase").then(({ createClient }) => {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        setUserEmail(user?.email ?? null);
      });
    });

    getProfile().then((p) => {
      const raw = p.child_birthday;
      let safeBirthday: string | undefined;
      if (raw) {
        const y = parseInt(raw.slice(0, 4), 10);
        if (!isNaN(y) && y >= 1000) safeBirthday = raw;
      }
      setProfile({ ...p, child_birthday: safeBirthday, role: isRoleLocked ? inviteRole! : p.role });

      if (searchParams.get("grant") === "1" && !p.is_owner) {
        grantSelfAdmin().then(() =>
          getProfile().then((fresh) =>
            setProfile((prev) => ({ ...prev, is_owner: fresh.is_owner }))
          )
        );
      }

      setLoading(false);
    });
  }, [isRoleLocked, inviteRole, searchParams]);

  const isOwner = profile.is_owner === true || userEmail === OWNER_EMAIL;

  // ── Save ──────────────────────────────────────────────────
  async function handleSave() {
    if (!profile.display_name.trim()) return;
    setBirthdayError(null);

    if (isOwner && profile.child_birthday) {
      const y = parseInt(profile.child_birthday.slice(0, 4), 10);
      if (isNaN(y) || y < 1000 || y < currentYear - MAX_AGE || y > currentYear) {
        setBirthdayError(`Please enter a valid birthday (ages 0–${MAX_AGE} supported).`);
        return;
      }
    }

    const payload: UserProfile = isOwner
      ? profile
      : { display_name: profile.display_name, role: profile.role, child_name: profile.child_name, child_birthday: profile.child_birthday, is_owner: false };

    setSaving(true);
    const result = await upsertProfile(payload);
    setSaving(false);
    setToastOk(!result.error);
    setToast(result.error ? "Failed to save. Try again." : "Saved!");
    setTimeout(() => setToast(null), 2500);
  }

  // ── Invite ─────────────────────────────────────────────────
  const handleInvite = useCallback(async (role: UserProfile["role"], grantAdmin = false) => {
    const url       = `${window.location.origin}/settings?role=${role}${grantAdmin ? "&grant=1" : ""}`;
    const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role;
    const childName  = getFirstName(profile.child_name)   || "your child";
    const inviterName = getFirstName(profile.display_name) || "Someone";

    const shareData = {
      title: `Join ${childName}'s Support Team on LinkSteps`,
      text:  `${inviterName} invites you to join as a ${roleLabel}. Click to connect:`,
      url,
    };

    if (typeof navigator.share === "function" && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
        setCopiedRole(role);
        setTimeout(() => setCopiedRole(null), 2000);
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    try { await navigator.clipboard.writeText(url); } catch { return; }
    setCopiedRole(role);
    setTimeout(() => setCopiedRole(null), 2000);
    setToastOk(true);
    setToast("Link copied! You can now paste it to WeChat.");
    setTimeout(() => setToast(null), 3000);
  }, [profile.child_name, profile.display_name]);

  function usedCount(role: UserProfile["role"]): number {
    return profile.role === role ? 1 : 0;
  }

  // ── Skeleton ───────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-8 pb-24">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 animate-pulse rounded-full bg-slate-200" />
            <div className="h-5 w-24 animate-pulse rounded-full bg-slate-200" />
          </div>
          {[1, 2].map((i) => (
            <div key={i} className="h-56 w-full animate-pulse rounded-3xl bg-slate-200" />
          ))}
        </div>
        <AppNav />
      </main>
    );
  }

  // ── Main ───────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-8 pb-24">
      <div className="w-full max-w-sm flex flex-col gap-5">

        {/* ── Header ───────────────────────────────────────── */}
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

        {/* ════════════════════════════════════════════════════
            MODULE 1 — Family Profile
            Your identity + child info + Save, all in one card.
        ════════════════════════════════════════════════════ */}
        <section className="rounded-3xl bg-white shadow-sm overflow-hidden">

          {/* ── Your Profile ──────────────────────────────── */}
          <div className="px-5 pt-5 pb-4 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Your Profile
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

            {/* Role — read-only; role is set at registration or via invite link */}
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-slate-700">Your Role</span>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <span className="text-base" aria-hidden="true">
                  {ROLES.find((r) => r.value === profile.role)?.icon ?? "🏠"}
                </span>
                <span className="text-sm font-medium text-slate-700">
                  {ROLES.find((r) => r.value === profile.role)?.label ?? "Parent"}
                </span>
                {isRoleLocked && (
                  <Lock className="ml-auto h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                )}
              </div>
            </div>

            {/* Relation / Title */}
            <div className="space-y-1.5">
              <label htmlFor="relation-title" className="block text-sm font-medium text-slate-700">
                Relation / Title
              </label>
              <input
                id="relation-title"
                type="text"
                value={profile.relation_title ?? ""}
                onChange={(e) => setProfile({ ...profile, relation_title: e.target.value })}
                placeholder="e.g. Father, Mother, Primary Teacher"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100 transition-colors"
              />
            </div>
          </div>

          {/* ── Divider ───────────────────────────────────── */}
          <div className="h-px bg-slate-100 mx-5" />

          {/* ── Kid's Info ────────────────────────────────── */}
          <div className="px-5 pt-4 pb-5 space-y-4">
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

            {/* Child Name */}
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
              {birthdayError && <p className="text-xs text-rose-500">{birthdayError}</p>}
              {isOwner && !birthdayError && profile.child_birthday && (() => {
                const y = parseInt(profile.child_birthday.slice(0, 4), 10);
                if (isNaN(y) || y < 1000) return null;
                const lbl = devStageLabel(profile.child_birthday);
                return lbl ? <p className="text-xs text-slate-400">{lbl}</p> : null;
              })()}
            </div>
          </div>

          {/* ── Save (inside the card, flush bottom) ──────── */}
          <div className="px-5 pb-5">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !profile.display_name.trim()}
              className="w-full rounded-2xl bg-sky-500 py-3.5 text-sm font-semibold text-white shadow-sm active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </section>

        {/* ── Toast ─────────────────────────────────────────── */}
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

        {/* ════════════════════════════════════════════════════
            MODULE 2 — Support Team Management (owner-only)
        ════════════════════════════════════════════════════ */}
        {isOwner && (
          <>
            {/* Backdrop for popover */}
            {popoverRole && (
              <div className="fixed inset-0 z-10" onClick={() => setPopoverRole(null)} aria-hidden="true" />
            )}

            <section className="rounded-3xl bg-white shadow-sm overflow-hidden">
              <div className="px-5 pt-5 pb-2">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Support Team
                </h2>
              </div>

              {/* ── Active Members ──────────────────────────── */}
              <div className="px-5 py-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                  Active Members
                </p>

                {/* Current user row — MVP: only own profile is known */}
                <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <span className="text-base" aria-hidden="true">
                    {ROLES.find((r) => r.value === profile.role)?.icon ?? "🏠"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700">
                      {getFirstName(profile.display_name) || "You"}
                    </p>
                    <p className="text-[10px] text-slate-400 capitalize">{profile.role} · you</p>
                  </div>
                  {/* Grant/Revoke Admin — parent rows only */}
                  {profile.role === "parent" && (
                    <button
                      type="button"
                      disabled
                      title={isOwner ? "Revoke admin" : "Grant admin"}
                      className="flex items-center gap-1 rounded-xl bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-600 opacity-60 cursor-not-allowed"
                    >
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      Admin
                    </button>
                  )}
                  {/* Remove — disabled for self */}
                  <button
                    type="button"
                    disabled
                    title="Cannot remove yourself"
                    className="flex items-center gap-1 rounded-xl bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-400 opacity-40 cursor-not-allowed"
                  >
                    <UserMinus className="h-3 w-3" aria-hidden="true" />
                    Remove
                  </button>
                </div>

                <p className="text-[10px] text-slate-300 pb-1">
                  Full member list requires the profiles DB migration.
                </p>
              </div>

              {/* ── Divider ──────────────────────────────────── */}
              <div className="h-px bg-slate-100 mx-5" />

              {/* ── Invite New Members ───────────────────────── */}
              <div className="px-5 pt-3 pb-5 space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                  Invite New Members
                </p>

                {QUOTAS.map(({ role, icon, label, total }) => {
                  const used     = usedCount(role);
                  const isFull   = used >= total;
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
                            setPopoverRole(popoverRole === "parent" ? null : "parent");
                            setGrantAdminInPopover(true);
                          } else {
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
                        {isCopied
                          ? <><Check className="h-3 w-3" />Shared!</>
                          : <><Copy className="h-3 w-3" />{isFull ? "Full" : "Invite"}</>
                        }
                      </button>

                      {/* Parent-only admin config popover */}
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

                <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                  Role is pre-set and locked when the recipient opens the link.
                </p>
              </div>

              {/* Grant/Revoke Admin note */}
              <div className="mx-5 mb-5 flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
                <ShieldOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  <span className="font-medium text-slate-500">Grant / Revoke Admin</span> for other
                  members will be available once the profiles DB migration runs and the full
                  member list loads.
                </p>
              </div>
            </section>
          </>
        )}

      </div>

      <AppNav />
    </main>
  );
}

// ── Page export (Suspense boundary for useSearchParams) ────────

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
