"use client";

import { useState } from "react";
import { Mail, ArrowRight, CheckCircle } from "lucide-react";
import { createClient } from "@/lib/supabase";

type FormState = "idle" | "loading" | "success" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!isValidEmail) {
      setFormState("error");
      setErrorMessage("请输入有效的邮箱地址");
      return;
    }

    setFormState("loading");
    setErrorMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setFormState("error");
      setErrorMessage("发送失败，请稍后重试");
    } else {
      setFormState("success");
    }
  }

  if (formState === "success") {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm text-center" role="status">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle className="h-7 w-7 text-emerald-400" />
          </div>
          <h2 className="text-lg font-semibold text-slate-800">
            链接已发送
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            请检查你的邮箱 <span className="font-medium text-slate-700">{email}</span>，点击链接即可登录。
          </p>
          <button
            type="button"
            onClick={() => {
              setFormState("idle");
              setEmail("");
            }}
            className="mt-6 text-sm text-sky-500 hover:text-sky-600 transition-colors"
          >
            使用其他邮箱
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-800">
            欢迎使用 LinkSteps
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            输入邮箱，我们将发送一个登录链接
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="sr-only">
              邮箱地址
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="你的邮箱地址"
                aria-describedby={formState === "error" ? "email-error" : undefined}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (formState === "error") {
                    setFormState("idle");
                    setErrorMessage("");
                  }
                }}
                className={`w-full rounded-3xl border py-3 pl-12 pr-4 text-sm outline-none transition-colors placeholder:text-slate-400 ${
                  formState === "error"
                    ? "border-red-300 focus:border-red-400"
                    : "border-slate-200 focus:border-sky-400"
                }`}
              />
            </div>
            {formState === "error" && errorMessage && (
              <p id="email-error" className="mt-2 pl-4 text-xs text-red-500" role="alert">
                {errorMessage}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={formState === "loading" || !email}
            className="flex w-full items-center justify-center gap-2 rounded-3xl bg-sky-500 py-3 text-sm font-medium text-white transition-transform active:scale-95 disabled:opacity-50 disabled:active:scale-100"
          >
            {formState === "loading" ? (
              "发送中…"
            ) : (
              <>
                发送登录链接
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
