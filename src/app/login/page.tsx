"use client";

import {
  useState,
  useRef,
  useCallback,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Mail, Phone, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { signInWithPhone, verifyPhoneOtp, signInWithEmail } from "@/lib/auth";

// ── Constants ─────────────────────────────────────────────────

const COUNTRY_CODES = [
  { label: "+1   🇺🇸", value: "+1" },
  { label: "+86  🇨🇳", value: "+86" },
  { label: "+44  🇬🇧", value: "+44" },
  { label: "+61  🇦🇺", value: "+61" },
  { label: "+65  🇸🇬", value: "+65" },
  { label: "+852 🇭🇰", value: "+852" },
  { label: "+81  🇯🇵", value: "+81" },
  { label: "+82  🇰🇷", value: "+82" },
] as const;

const OTP_LENGTH = 6;

// ── Types ─────────────────────────────────────────────────────

type Tab = "phone" | "email";
type PhoneStep = "input" | "otp";
type Status = "idle" | "loading" | "success" | "error";

// ── OTP Input ─────────────────────────────────────────────────

interface OtpInputProps {
  value: string[];
  onChange: (otp: string[]) => void;
}

function OtpInput({ value, onChange }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  function handleChange(i: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const next = [...value];
    next[i] = digit;
    onChange(next);
    if (digit && i < OTP_LENGTH - 1) refs.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const digits = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, OTP_LENGTH);
    const next = Array.from({ length: OTP_LENGTH }, (_, i) => digits[i] ?? "");
    onChange(next);
    const focusIdx = Math.min(digits.length, OTP_LENGTH - 1);
    refs.current[focusIdx]?.focus();
  }

  return (
    <div className="flex justify-center gap-2" role="group" aria-label="One-time code">
      {Array.from({ length: OTP_LENGTH }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          /* @QA: numeric keyboard on mobile */
          inputMode="numeric"
          pattern="[0-9]"
          maxLength={2} /* allows overtype replacement */
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          value={value[i]}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          onFocus={(e) => e.target.select()}
          className={`h-12 w-10 rounded-2xl border text-center text-lg font-semibold text-slate-800 outline-none transition-colors ${
            value[i]
              ? "border-sky-400 bg-sky-50"
              : "border-slate-200 bg-white focus:border-sky-400"
          }`}
        />
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("phone");

  // Phone state
  const [countryCode, setCountryCode] = useState("+1");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneStep, setPhoneStep] = useState<PhoneStep>("input");
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [phoneStatus, setPhoneStatus] = useState<Status>("idle");
  const [phoneError, setPhoneError] = useState("");

  // Email state
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<Status>("idle");
  const [emailError, setEmailError] = useState("");

  const fullPhone = `${countryCode}${phoneNumber.replace(/\D/g, "")}`;
  const otpFilled = otp.every((d) => d !== "");

  // ── Tab switch ──────────────────────────────────────────────
  function switchTab(next: Tab) {
    if (next === tab) return;
    setTab(next);
    // Reset both sides to avoid stale state
    setPhoneStep("input");
    setPhoneStatus("idle");
    setPhoneError("");
    setEmailStatus("idle");
    setEmailError("");
  }

  // ── Phone handlers ──────────────────────────────────────────
  async function handleSendCode() {
    if (!phoneNumber.trim()) {
      setPhoneError("Please enter your phone number.");
      return;
    }
    setPhoneStatus("loading");
    setPhoneError("");
    const result = await signInWithPhone(fullPhone);
    if ("error" in result) {
      setPhoneStatus("error");
      setPhoneError(result.error);
    } else {
      setPhoneStatus("idle");
      setPhoneStep("otp");
      setOtp(Array(OTP_LENGTH).fill(""));
    }
  }

  const handleVerifyOtp = useCallback(async () => {
    if (!otpFilled) return;
    setPhoneStatus("loading");
    setPhoneError("");
    const result = await verifyPhoneOtp(fullPhone, otp.join(""));
    if ("error" in result) {
      setPhoneStatus("error");
      setPhoneError(result.error);
      setOtp(Array(OTP_LENGTH).fill(""));
    } else {
      router.push("/log");
    }
  }, [fullPhone, otp, otpFilled, router]);

  // Auto-submit when all 6 digits are filled
  const prevOtpFilled = useRef(false);
  if (otpFilled && !prevOtpFilled.current && phoneStep === "otp") {
    prevOtpFilled.current = true;
    void handleVerifyOtp();
  }
  if (!otpFilled) prevOtpFilled.current = false;

  // ── Email handler ───────────────────────────────────────────
  async function handleSendLink(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    setEmailStatus("loading");
    setEmailError("");
    const result = await signInWithEmail(email);
    if ("error" in result) {
      setEmailStatus("error");
      setEmailError(result.error);
    } else {
      setEmailStatus("success");
    }
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm">

        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-800">
            Welcome to LinkSteps
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Sign in to continue
          </p>
        </div>

        {/* ── Tabs ────────────────────────────────────────────── */}
        <div
          className="mb-6 flex rounded-2xl bg-slate-100 p-1 gap-1"
          role="tablist"
          aria-label="Sign-in method"
        >
          {(["phone", "email"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              aria-controls={`panel-${t}`}
              onClick={() => switchTab(t)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-all ${
                tab === t
                  ? "bg-white shadow-sm text-slate-800"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "phone" ? (
                <Phone className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {t === "phone" ? "Phone" : "Email"}
            </button>
          ))}
        </div>

        {/* ── Phone panel ─────────────────────────────────────── */}
        <div
          id="panel-phone"
          role="tabpanel"
          aria-labelledby="tab-phone"
          hidden={tab !== "phone"}
        >
          {phoneStep === "input" ? (
            /* Step 1 — phone number entry */
            <div className="space-y-4">
              <div>
                <label htmlFor="phone" className="sr-only">Phone number</label>
                <div className="flex gap-2">
                  {/* Country code selector */}
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    aria-label="Country code"
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 outline-none focus:border-sky-400 transition-colors"
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>

                  {/* Phone number — @QA: inputMode="tel" triggers dial-pad on mobile */}
                  <input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    placeholder="Phone number"
                    value={phoneNumber}
                    aria-describedby={phoneError ? "phone-error" : undefined}
                    aria-invalid={!!phoneError}
                    onChange={(e) => {
                      setPhoneNumber(e.target.value);
                      if (phoneError) setPhoneError("");
                    }}
                    className={`min-w-0 flex-1 rounded-2xl border py-3 px-4 text-sm outline-none transition-colors ${
                      phoneError
                        ? "border-red-300 focus:border-red-400"
                        : "border-slate-200 focus:border-sky-400"
                    }`}
                  />
                </div>

                {phoneError && (
                  <p id="phone-error" className="mt-2 pl-1 text-xs text-red-500" role="alert">
                    {phoneError}
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={phoneStatus === "loading" || !phoneNumber.trim()}
                onClick={handleSendCode}
                className="flex w-full items-center justify-center gap-2 rounded-3xl bg-sky-500 py-3 text-sm font-medium text-white transition-transform active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              >
                {phoneStatus === "loading" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Sending…
                  </>
                ) : (
                  <>
                    Send Code
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          ) : (
            /* Step 2 — OTP verification */
            <div className="space-y-5">
              <div className="text-center">
                <p className="text-sm text-slate-600">
                  Enter the 6-digit code sent to
                </p>
                <p className="mt-0.5 font-medium text-slate-800">{fullPhone}</p>
              </div>

              {/* @QA: inputMode="numeric" + pattern on each box */}
              <OtpInput value={otp} onChange={setOtp} />

              {phoneError && (
                <p className="text-center text-xs text-red-500" role="alert">
                  {phoneError}
                </p>
              )}

              <button
                type="button"
                disabled={!otpFilled || phoneStatus === "loading"}
                onClick={handleVerifyOtp}
                className="flex w-full items-center justify-center gap-2 rounded-3xl bg-sky-500 py-3 text-sm font-medium text-white transition-transform active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              >
                {phoneStatus === "loading" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Verifying…
                  </>
                ) : (
                  "Verify Code"
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setPhoneStep("input");
                  setPhoneError("");
                  setPhoneStatus("idle");
                }}
                className="w-full text-center text-sm text-slate-400 hover:text-sky-500 transition-colors"
              >
                Send a new code
              </button>
            </div>
          )}
        </div>

        {/* ── Email panel ──────────────────────────────────────── */}
        <div
          id="panel-email"
          role="tabpanel"
          aria-labelledby="tab-email"
          hidden={tab !== "email"}
        >
          {emailStatus === "success" ? (
            /* Email success state */
            <div className="flex flex-col items-center gap-4 py-2 text-center" role="status" aria-live="polite">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-7 w-7 text-emerald-400" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium text-slate-800">Check your email</p>
                <p className="mt-1 text-sm text-slate-500">
                  We sent a sign-in link to{" "}
                  <span className="font-medium text-slate-700">{email}</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEmailStatus("idle");
                  setEmail("");
                }}
                className="text-sm text-sky-500 hover:text-sky-600 transition-colors"
              >
                Use a different email
              </button>
            </div>
          ) : (
            /* Email form */
            <form onSubmit={handleSendLink} noValidate className="space-y-4">
              <div>
                <label htmlFor="email" className="sr-only">Email address</label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    aria-describedby={emailError ? "email-error" : undefined}
                    aria-invalid={!!emailError}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) setEmailError("");
                    }}
                    className={`w-full rounded-3xl border py-3 pl-12 pr-4 text-sm outline-none transition-colors placeholder:text-slate-400 ${
                      emailError
                        ? "border-red-300 focus:border-red-400"
                        : "border-slate-200 focus:border-sky-400"
                    }`}
                  />
                </div>
                {emailError && (
                  <p id="email-error" className="mt-2 pl-4 text-xs text-red-500" role="alert">
                    {emailError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={emailStatus === "loading" || !email}
                className="flex w-full items-center justify-center gap-2 rounded-3xl bg-sky-500 py-3 text-sm font-medium text-white transition-transform active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              >
                {emailStatus === "loading" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Sending…
                  </>
                ) : (
                  <>
                    Send Link
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>

      </div>
    </main>
  );
}
