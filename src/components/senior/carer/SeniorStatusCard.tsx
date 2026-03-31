"use client";

/**
 * SeniorStatusCard
 *
 * The core card on the carer dashboard. One card per senior.
 *
 * Shows:
 *  - Status badge (Emerald / Amber / Rose / SOS)
 *  - AI-generated insight sentence
 *  - Last check-in time (realtime-updated by parent)
 *  - City + weather line
 *  - Quick-action buttons
 */

import Link from "next/link";
import { Phone, MessageCircle, ChevronRight } from "lucide-react";
import StatusBadge, { SeniorStatus } from "./StatusBadge";

const BORDER: Record<SeniorStatus, string> = {
  emerald: "border-l-emerald-400",
  amber:   "border-l-amber-400",
  rose:    "border-l-rose-400",
  sos:     "border-l-red-500",
};

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "今天还未发送平安信号";
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚发送了平安信号 💚";
  if (minutes < 60) return `${minutes} 分钟前发送了平安信号`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前发送了平安信号`;
  return "超过 24 小时未发送平安信号";
}

export interface SeniorCardData {
  id: string;
  name: string;
  city: string;
  status: SeniorStatus;
  insightText: string;
  actionSuggestion: string | null;
  lastCheckinAt: string | null;
  weatherText?: string;
  weatherTempC?: number;
}

interface SeniorStatusCardProps {
  senior: SeniorCardData;
}

export default function SeniorStatusCard({ senior }: SeniorStatusCardProps) {
  const isSos = senior.status === "sos";

  return (
    <Link href={`/carer/senior/${senior.id}`} className="block">
      <div
        className={[
          "bg-white rounded-3xl border-l-4 shadow-sm",
          "px-5 py-5 flex flex-col gap-3",
          "active:scale-[0.99] transition-transform duration-150",
          isSos ? "ring-2 ring-red-400 ring-offset-2" : "",
          BORDER[senior.status],
        ].join(" ")}
      >
        {/* ── Row 1: name + status badge ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Avatar circle */}
            <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-xl font-semibold text-slate-500 shrink-0">
              {senior.name.slice(-1)}
            </div>
            <div>
              <p className="text-slate-800 font-semibold text-lg leading-tight">
                {senior.name}
              </p>
              {/* City + weather */}
              <p className="text-slate-400 text-xs mt-0.5">
                📍 {cityLabel(senior.city)}
                {senior.weatherText && senior.weatherTempC !== undefined
                  ? ` · ${senior.weatherText} · ${senior.weatherTempC}°C`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={senior.status} />
            <ChevronRight className="w-4 h-4 text-slate-300" />
          </div>
        </div>

        {/* ── Row 2: AI insight ── */}
        <p className="text-slate-600 text-sm leading-relaxed">
          {senior.insightText}
        </p>

        {/* ── Row 3: action suggestion (amber/rose only) ── */}
        {senior.actionSuggestion && senior.status !== "emerald" && (
          <p className="text-slate-500 text-xs bg-slate-50 rounded-xl px-3 py-2 leading-relaxed">
            💡 {senior.actionSuggestion}
          </p>
        )}

        {/* ── Row 4: last check-in + quick actions ── */}
        <div className="flex items-center justify-between mt-1">
          <p
            className={[
              "text-xs",
              senior.lastCheckinAt ? "text-emerald-600" : "text-slate-400",
            ].join(" ")}
          >
            {formatRelativeTime(senior.lastCheckinAt)}
          </p>

          {/* Quick-action buttons */}
          <div className="flex gap-2">
            <button
              onClick={(e) => { e.preventDefault(); /* TODO: open message sheet */ }}
              className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center active:bg-slate-200 transition-colors"
              aria-label="发送消息"
            >
              <MessageCircle className="w-4 h-4 text-slate-500" />
            </button>
            <button
              onClick={(e) => { e.preventDefault(); /* TODO: initiate call */ }}
              className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center active:bg-slate-200 transition-colors"
              aria-label="拨打电话"
            >
              <Phone className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}

// Map QWeather city keys to Chinese display names
function cityLabel(city: string): string {
  const MAP: Record<string, string> = {
    beijing:   "北京",
    shanghai:  "上海",
    shenzhen:  "深圳",
    guangzhou: "广州",
    chengdu:   "成都",
  };
  return MAP[city.toLowerCase()] ?? city;
}
