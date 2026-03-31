/**
 * CheckinTimeline
 *
 * Vertical timeline of recent 平安扣 check-ins.
 * New entries animate in from the top (slideDown keyframe).
 */

export interface CheckinRow {
  id:            string;
  checked_in_at: string;
  source:        string;
  isNew?:        boolean; // set by realtime handler for animation
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min  = Math.floor(diff / 60_000);
  if (min < 1)  return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h} 小时前`;
  if (h < 48)   return "昨天 " + absoluteHHMM(iso);
  return `${Math.floor(h / 24)} 天前`;
}

function absoluteHHMM(iso: string): string {
  const d  = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

interface CheckinTimelineProps {
  entries: CheckinRow[];
}

export default function CheckinTimeline({ entries }: CheckinTimelineProps) {
  if (entries.length === 0) {
    return (
      <p className="text-slate-400 text-sm text-center py-8">
        暂无记录
      </p>
    );
  }

  return (
    <ol className="relative flex flex-col gap-0">
      {entries.map((entry, i) => {
        const isFirst = i === 0;
        return (
          <li
            key={entry.id}
            className={[
              "relative flex gap-4 pb-6",
              entry.isNew ? "animate-[slideDown_0.4s_ease-out]" : "",
            ].join(" ")}
          >
            {/* Vertical line */}
            {i < entries.length - 1 && (
              <div className="absolute left-[9px] top-5 bottom-0 w-px bg-slate-100" />
            )}

            {/* Dot */}
            <div
              className={[
                "relative z-10 mt-1 w-5 h-5 rounded-full shrink-0 flex items-center justify-center",
                isFirst
                  ? "bg-emerald-500 ring-4 ring-emerald-100"
                  : "bg-slate-200",
              ].join(" ")}
            >
              {isFirst && (
                <div className="w-2 h-2 rounded-full bg-white" />
              )}
            </div>

            {/* Content */}
            <div className="flex flex-col gap-0.5 pt-0.5">
              <p
                className={[
                  "text-sm font-medium",
                  isFirst ? "text-emerald-700" : "text-slate-600",
                ].join(" ")}
              >
                发送了平安信号
              </p>
              <p className="text-xs text-slate-400">
                {relativeTime(entry.checked_in_at)}
                <span className="mx-1.5 opacity-40">·</span>
                {absoluteHHMM(entry.checked_in_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
