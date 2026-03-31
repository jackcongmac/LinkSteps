/**
 * FactorCard
 *
 * Displays one sensor factor (Steps / Sleep / HRV / Pressure / Pollen).
 *
 * Design rules:
 *  - Icon + single large status value only — NO charts, NO trend lines
 *  - Normal state: cream surface card
 *  - Warn state:   warm terracotta (#D4A373) outline — never red, never alarming
 *  - All transitions: 400ms ease-out
 */

interface FactorCardProps {
  icon:    string;          // emoji icon
  label:   string;          // e.g. "步数"
  value:   string;          // e.g. "4,200 步" — pre-formatted by parent
  warn?:   boolean;         // subtle attention state
  dimmed?: boolean;         // Phase 2 data not yet available
}

export default function FactorCard({
  icon,
  label,
  value,
  warn   = false,
  dimmed = false,
}: FactorCardProps) {
  return (
    <div
      className={[
        // Base shape
        "flex flex-col items-center justify-center gap-2",
        "rounded-[24px] px-4 py-5",
        "min-w-[88px] flex-1",
        // Surface & border
        warn
          ? "bg-senior-surface border-2 border-[#D4A373]"
          : "bg-senior-surface border-2 border-transparent",
        // Opacity for unavailable data
        dimmed ? "opacity-40" : "opacity-100",
        // Soft transition
        "transition-all duration-[400ms] ease-out",
      ].join(" ")}
    >
      <span className="text-3xl leading-none">{icon}</span>
      <span
        className={[
          "text-lg font-semibold leading-tight text-center",
          warn ? "text-[#D4A373]" : "text-senior-text",
          "transition-colors duration-[400ms] ease-out",
        ].join(" ")}
      >
        {value}
      </span>
      <span className="text-[11px] text-senior-muted tracking-wide uppercase">
        {label}
      </span>
    </div>
  );
}
