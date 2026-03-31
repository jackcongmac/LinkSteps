/**
 * StatusBadge
 *
 * Displays the four AI-assessed senior health states.
 * Maps directly to the status values in ai_assessments.status.
 */

export type SeniorStatus = "emerald" | "amber" | "rose" | "sos";

const CONFIG: Record<
  SeniorStatus,
  { label: string; emoji: string; pill: string; dot: string }
> = {
  emerald: {
    label: "平稳",
    emoji: "🟢",
    pill: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    dot: "bg-emerald-400",
  },
  amber: {
    label: "关注",
    emoji: "🟡",
    pill: "bg-amber-50 text-amber-700 border border-amber-200",
    dot: "bg-amber-400",
  },
  rose: {
    label: "异动",
    emoji: "🔴",
    pill: "bg-rose-50 text-rose-700 border border-rose-200",
    dot: "bg-rose-400",
  },
  sos: {
    label: "紧急",
    emoji: "🚨",
    pill: "bg-red-100 text-red-700 border border-red-300 animate-pulse",
    dot: "bg-red-500",
  },
};

interface StatusBadgeProps {
  status: SeniorStatus;
  showDot?: boolean;
}

export default function StatusBadge({ status, showDot = false }: StatusBadgeProps) {
  const c = CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${c.pill}`}>
      {showDot && (
        <span className={`w-2 h-2 rounded-full ${c.dot}`} />
      )}
      {c.emoji} {c.label}
    </span>
  );
}
