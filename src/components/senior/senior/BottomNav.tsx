"use client";

import { Home, MessageCircle, BarChart2, Settings } from "lucide-react";

export type SeniorTab = "status" | "messages" | "insights" | "settings";

const TABS: {
  id:    SeniorTab;
  icon:  React.ElementType;
  label: string;
}[] = [
  { id: "status",   icon: Home,          label: "状态" },
  { id: "messages", icon: MessageCircle, label: "消息" },
  { id: "insights", icon: BarChart2,     label: "洞察" },
  { id: "settings", icon: Settings,      label: "设置" },
];

interface BottomNavProps {
  active:   SeniorTab;
  onChange: (tab: SeniorTab) => void;
}

export default function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav className="w-full bg-white border-t border-gray-100 px-2 py-2 flex items-center justify-around safe-area-pb">
      {TABS.map(({ id, icon: Icon, label }) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={[
              "flex flex-col items-center gap-1 px-4 py-1.5 rounded-2xl",
              "transition-all duration-[400ms] ease-out",
              isActive ? "bg-senior-nav-active" : "bg-transparent",
            ].join(" ")}
          >
            <Icon
              className={[
                "w-5 h-5 transition-colors duration-[400ms] ease-out",
                isActive ? "text-senior-status" : "text-senior-muted",
              ].join(" ")}
              strokeWidth={isActive ? 2.2 : 1.8}
            />
            <span
              className={[
                "text-[11px] font-medium transition-colors duration-[400ms] ease-out",
                isActive ? "text-senior-status" : "text-senior-muted",
              ].join(" ")}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
