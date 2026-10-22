"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/", "All roles"],
  ["/inbox", "Inbox"],
  ["/settings", "Settings"],
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-4 text-sm">
      {LINKS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          className={
            pathname === href
              ? "font-medium text-gray-900 underline underline-offset-4"
              : "text-gray-500 hover:text-gray-900"
          }
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
