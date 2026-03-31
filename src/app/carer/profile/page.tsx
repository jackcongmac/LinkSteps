"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, QrCode, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase";

// ── Relationship → Gender auto-fill ───────────────────────────

type Relationship = "父亲" | "母亲" | "公公" | "婆婆" | "其他";
type Gender = "男" | "女" | "";

const RELATIONSHIP_OPTIONS: Relationship[] = ["父亲", "母亲", "公公", "婆婆", "其他"];

const RELATIONSHIP_GENDER: Record<Relationship, Gender> = {
  父亲: "男",
  公公: "男",
  母亲: "女",
  婆婆: "女",
  其他: "",
};

// ── Page ──────────────────────────────────────────────────────

export default function SeniorProfilePage() {
  const router   = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [seniorId,      setSeniorId]      = useState<string | null>(null);
  const [name,          setName]          = useState("");
  const [age,           setAge]           = useState("");
  const [gender,        setGender]        = useState<Gender>("");
  const [relationship,  setRelationship]  = useState<Relationship | "">("");
  const [customRelation,setCustomRelation]= useState("");
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [toast,         setToast]         = useState<string | null>(null);

  // Load existing senior profile
  useEffect(() => {
    supabase
      .from("senior_profiles")
      .select("id, name")
      .limit(1)
      .then(({ data }) => {
        const row = (data as { id: string; name: string }[] | null)?.[0];
        if (row) {
          setSeniorId(row.id);
          setName(row.name);
        }
        setLoading(false);
      });
  }, [supabase]);

  // Auto-fill gender when relationship changes
  function handleRelationshipChange(rel: Relationship) {
    setRelationship(rel);
    const autoGender = RELATIONSHIP_GENDER[rel];
    if (autoGender) setGender(autoGender);
    else setGender("");
  }

  async function handleSave() {
    if (!name.trim() || !seniorId) return;
    setSaving(true);

    const { error } = await supabase
      .from("senior_profiles")
      .update({ name: name.trim() })
      .eq("id", seniorId);

    setSaving(false);
    if (error) {
      setToast("保存失败，请重试");
    } else {
      setToast("已保存");
    }
    setTimeout(() => setToast(null), 2500);
  }

  // ── Loading ────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-200 border-t-emerald-500 animate-spin" />
      </main>
    );
  }

  // ── Main ──────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center px-4 py-8 pb-24">
      <div className="w-full max-w-sm flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm active:scale-95 transition-transform"
            aria-label="返回"
          >
            <ArrowLeft className="h-4 w-4 text-slate-600" />
          </button>
          <h1 className="text-lg font-semibold text-slate-800">长辈信息</h1>
        </div>

        {/* Profile card */}
        <section className="rounded-3xl bg-white shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-5 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              基本信息
            </h2>

            {/* 姓名 */}
            <div className="space-y-1.5">
              <label htmlFor="senior-name" className="block text-sm font-medium text-slate-700">
                姓名
              </label>
              <input
                id="senior-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：陈阿姨"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100 transition-colors"
              />
            </div>

            {/* 年龄 */}
            <div className="space-y-1.5">
              <label htmlFor="senior-age" className="block text-sm font-medium text-slate-700">
                年龄
              </label>
              <input
                id="senior-age"
                type="number"
                inputMode="numeric"
                min={50}
                max={120}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="例：72"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100 transition-colors"
              />
            </div>

            {/* 与您的关系 */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">
                与您的关系
              </label>
              <div className="grid grid-cols-5 gap-2">
                {RELATIONSHIP_OPTIONS.map((rel) => (
                  <button
                    key={rel}
                    type="button"
                    onClick={() => handleRelationshipChange(rel)}
                    className={[
                      "rounded-2xl py-2 text-sm font-medium transition-all active:scale-95",
                      relationship === rel
                        ? "bg-sky-500 text-white shadow-sm"
                        : "bg-slate-50 border border-slate-200 text-slate-600",
                    ].join(" ")}
                  >
                    {rel}
                  </button>
                ))}
              </div>
            </div>

            {/* 其他：自定义关系文本框 */}
            {relationship === "其他" && (
              <div className="space-y-1.5">
                <label htmlFor="custom-relation" className="block text-sm font-medium text-slate-700">
                  具体关系
                </label>
                <input
                  id="custom-relation"
                  type="text"
                  value={customRelation}
                  onChange={(e) => setCustomRelation(e.target.value)}
                  placeholder="例：外婆、姑妈…"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100 transition-colors"
                />
              </div>
            )}

            {/* 性别 — auto-filled for known relationships; manual for 其他 */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">性别</label>
              <div className="flex gap-2">
                {(["男", "女"] as Gender[]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    disabled={relationship !== "其他" && relationship !== ""}
                    onClick={() => setGender(g)}
                    className={[
                      "flex-1 rounded-2xl py-2.5 text-sm font-medium transition-all active:scale-95",
                      gender === g
                        ? "bg-sky-500 text-white shadow-sm"
                        : "bg-slate-50 border border-slate-200 text-slate-600",
                      relationship !== "其他" && relationship !== ""
                        ? "opacity-60 cursor-not-allowed"
                        : "",
                    ].join(" ")}
                  >
                    {g === "男" ? "👨 男" : "👩 女"}
                  </button>
                ))}
              </div>
              {relationship !== "" && relationship !== "其他" && (
                <p className="text-[11px] text-slate-400">根据关系自动填写</p>
              )}
            </div>
          </div>

          {/* Save */}
          <div className="px-5 pb-5">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="w-full rounded-2xl bg-sky-500 py-3.5 text-sm font-semibold text-white shadow-sm active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </section>

        {/* Toast */}
        {toast && (
          <div
            className="flex items-center justify-center gap-2 rounded-3xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-600"
            role="status"
            aria-live="polite"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {toast}
          </div>
        )}

        {/* 平安扣邀请二维码 */}
        <section className="rounded-3xl bg-white shadow-sm px-5 py-6">
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-3xl bg-indigo-50 flex items-center justify-center">
              <QrCode className="w-10 h-10 text-indigo-400" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-slate-700 font-semibold text-base">平安扣邀请二维码</p>
              <p className="text-slate-400 text-sm leading-relaxed">
                生成专属二维码，发送给长辈扫码<br />绑定平安扣手环设备
              </p>
            </div>
            <button
              type="button"
              disabled
              className="w-full rounded-2xl bg-indigo-100 py-4 text-sm font-semibold text-indigo-400 cursor-not-allowed flex items-center justify-center gap-2"
            >
              <QrCode className="w-4 h-4" />
              生成平安扣邀请二维码
            </button>
            <span className="text-[11px] text-slate-300 bg-slate-50 px-3 py-1 rounded-full">功能即将上线</span>
          </div>
        </section>

      </div>
    </main>
  );
}
