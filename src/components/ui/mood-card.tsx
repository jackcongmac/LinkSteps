"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import MoodPicker, {
  moodOptions,
  type MoodLevel,
  type MoodIconName,
} from "@/components/ui/mood-picker";

interface MoodCardProps {
  childName?: string;
  onSave: (mood: MoodLevel, iconName: MoodIconName) => void;
}

export default function MoodCard({
  childName = "Ethan",
  onSave,
}: MoodCardProps) {
  const [selected, setSelected] = useState<MoodLevel | undefined>();

  function handleSave() {
    if (selected === undefined) return;
    const option = moodOptions.find((o) => o.level === selected);
    if (option) {
      onSave(selected, option.iconName);
    }
  }

  return (
    <section className="rounded-3xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Heart className="h-5 w-5 text-sky-600" aria-hidden="true" />
        <h2 className="text-slate-700 font-medium">
          {childName} 今日情绪
        </h2>
      </div>

      <MoodPicker value={selected} onChange={setSelected} />

      <button
        type="button"
        disabled={selected === undefined}
        onClick={handleSave}
        className={`mt-4 w-full rounded-3xl py-3 text-sm font-medium transition-transform ${
          selected !== undefined
            ? "bg-sky-500 text-white active:scale-95"
            : "bg-slate-200 text-slate-400 cursor-not-allowed"
        }`}
      >
        保存
      </button>
    </section>
  );
}
