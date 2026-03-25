"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PenLine, BarChart2 } from "lucide-react";

const NAV_ITEMS = [
  { href: "/log",      label: "Log",     Icon: PenLine   },
  { href: "/insights", label: "Insights", Icon: BarChart2 },
] as const;

export default function AppNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-100 bg-white/90 backdrop-blur-sm"
      aria-label="Main navigation"
    >
      <div className="mx-auto flex max-w-sm">
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-3 text-xs font-medium transition-colors ${
                active ? "text-sky-500" : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <Icon
                className={`h-5 w-5 ${active ? "text-sky-500" : "text-slate-400"}`}
                aria-hidden="true"
              />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
