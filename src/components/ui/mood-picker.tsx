"use client";

import { Zap, CloudRain, Cloud, Smile, Sun } from "lucide-react";
import type { MoodValue } from "@/types";
import type { LucideIcon } from "lucide-react";

export type MoodLevel = MoodValue["level"];

export type MoodIconName = "Zap" | "CloudRain" | "Cloud" | "Smile" | "Sun";

interface MoodOption {
  level: MoodLevel;
  label: string;
  icon: LucideIcon;
  iconName: MoodIconName;
}

export const moodOptions: MoodOption[] = [
  { level: 1, label: "很低落", icon: Zap, iconName: "Zap" },
  { level: 2, label: "不太好", icon: CloudRain, iconName: "CloudRain" },
  { level: 3, label: "一般", icon: Cloud, iconName: "Cloud" },
  { level: 4, label: "不错", icon: Smile, iconName: "Smile" },
  { level: 5, label: "很开心", icon: Sun, iconName: "Sun" },
];

interface MoodPickerProps {
  value?: MoodLevel;
  onChange: (mood: MoodLevel) => void;
}

export default function MoodPicker({ value, onChange }: MoodPickerProps) {
  return (
    <fieldset className="rounded-3xl bg-white p-4 shadow-sm">
      <legend className="sr-only">选择今日情绪</legend>
      <div className="flex items-center justify-between gap-2">
        {moodOptions.map(({ level, label, icon: Icon }) => {
          const isSelected = value === level;
          return (
            <button
              key={level}
              type="button"
              aria-label={label}
              aria-pressed={isSelected}
              onClick={() => onChange(level)}
              className={`flex flex-1 flex-col items-center gap-1.5 rounded-2xl min-h-[44px] py-3 active:scale-95 ${
                isSelected
                  ? "bg-sky-100 text-sky-700 ring-2 ring-sky-400 scale-110 transition-all"
                  : "bg-white text-slate-500 hover:bg-slate-50 transition-all"
              }`}
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
              <span className="text-xs font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
