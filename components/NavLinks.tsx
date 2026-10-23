"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/", "All roles"],
  ["/pets", "Pets"],
  ["/inbox", "Email matches"],
  ["/settings", "Settings"],
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1.5 rounded-2xl border-2 border-peach-200 bg-white p-1 font-display text-sm font-semibold">
      {LINKS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className={
            pathname === href
              ? "rounded-xl bg-carrot-400 px-3 py-1.5 text-white shadow-[0_3px_0_var(--color-carrot-700)]"
              : "rounded-xl px-3 py-1.5 text-cocoa-500 hover:bg-peach-100 hover:text-cocoa-900"
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
