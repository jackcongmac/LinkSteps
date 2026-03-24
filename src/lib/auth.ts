/**
 * auth.ts — Centralised auth helpers for LinkSteps.
 *
 * Two supported sign-in methods:
 *   • Phone (SMS OTP) — 2-step: send OTP → verify OTP
 *   • Email (Magic Link) — 1-step: send link → user clicks → /auth/callback
 *
 * ─── Development / No-Twilio setup ─────────────────────────────────────────
 * Phone auth does NOT require Twilio to work during development.
 * Supabase lets you register test phone numbers with pre-set OTP tokens:
 *
 *   Supabase Dashboard → Authentication → Phone Provider
 *   → "Test Phone Numbers" section
 *   Add: +15550001234  /  token: 123456
 *
 * Calls to signInWithPhone('+15550001234') will succeed without sending a real
 * SMS. verifyPhoneOtp('+15550001234', '123456') will establish a real session.
 * ───────────────────────────────────────────────────────────────────────────
 */
import { createClient } from '@/lib/supabase';

export type AuthResult = { success: true } | { error: string };

// ── Phone auth ────────────────────────────────────────────────

/**
 * Step 1 — send a 6-digit OTP to the given E.164 phone number.
 *
 * Input must be in E.164 format: +{countryCode}{localNumber}
 * e.g.  +16502530000   +8613800138000
 */
export async function signInWithPhone(phone: string): Promise<AuthResult> {
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) return { error: error.message };
    return { success: true };
  } catch {
    return { error: 'Network error. Please check your connection.' };
  }
}

/**
 * Step 2 — verify the OTP token and establish an authenticated session.
 *
 * @param phone  — same E.164 number used in signInWithPhone
 * @param token  — 6-digit code received via SMS (or Supabase test token)
 */
export async function verifyPhoneOtp(
  phone: string,
  token: string,
): Promise<AuthResult> {
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });
    if (error) return { error: error.message };
    return { success: true };
  } catch {
    return { error: 'Network error. Please check your connection.' };
  }
}

// ── Email auth ────────────────────────────────────────────────

/**
 * Send a Magic Link to the given email address.
 * The link points to /auth/callback, which exchanges the code for a session
 * and redirects the user into the app.
 */
export async function signInWithEmail(email: string): Promise<AuthResult> {
  try {
    const supabase = createClient();
    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback`
        : '/auth/callback';

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) return { error: error.message };
    return { success: true };
  } catch {
    return { error: 'Network error. Please check your connection.' };
  }
}
