"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/", "All roles"],
  ["/pets", "Pets"],
  ["/inbox", "Email matches"],
  ["/settings", "Settings"],
] as const;

// Numbered, like an agency site's index.
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {LINKS.map(([href, label], i) => {
        const current = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`group flex items-baseline gap-1.5 ${current ? "text-ink-900" : "text-ink-500 hover:text-ink-900"}`}
          >
            <span className={`label-mono ${current ? "text-accent-500" : "text-ink-300 group-hover:text-accent-500"}`}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className={current ? "font-medium underline decoration-1 underline-offset-[6px]" : ""}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
