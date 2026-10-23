"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icons";

const LINKS: [string, string, IconName][] = [
  ["/", "Dashboard", "grid"],
  ["/pets", "Pets", "paw"],
  ["/inbox", "Email matches", "mail"],
  ["/settings", "Settings", "gear"],
];

// Numbered index: a row on small screens, a column in the sidebar.
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 text-sm lg:flex-col">
      {LINKS.map(([href, label, icon], i) => {
        const current = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-full px-3 py-2 transition-colors ${
              current ? "bg-ink-900 text-paper-50" : "text-ink-500 hover:bg-paper-100 hover:text-ink-900"
            }`}
          >
            <Icon name={icon} size={17} className={current ? "text-accent-400" : ""} />
            <span className="flex-1">{label}</span>
            <span className={`label-mono hidden lg:inline ${current ? "text-paper-100/60" : "text-ink-300"}`}>
              {String(i + 1).padStart(2, "0")}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
