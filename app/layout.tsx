import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

// A tight grotesk for everything, set large for titles; mono for small labels.
const interTight = Inter_Tight({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter-tight" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "Jobs ki mkb",
  description: "Shared board of internships, part-time jobs, fellowships and hackathons, with pets that grow as you apply.",
};

// Sidebar on large screens, a top bar on small ones.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen font-sans antialiased lg:flex">
        <aside className="border-b border-line-200 bg-paper-50 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6 lg:block lg:px-5 lg:py-7">
            <Link href="/" className="title-outline text-[26px] leading-none">
              Jobs ki mkb<span className="text-accent-500">.</span>
            </Link>
            <p className="label-mono mt-2 hidden text-ink-300 lg:block">Taran · Shlok · Muzammil</p>
            <div className="lg:mt-10">
              <NavLinks />
            </div>
          </div>
          <div className="mt-auto hidden px-5 pb-6 lg:block">
            <div className="rounded-2xl bg-ink-900 p-4 text-paper-50">
              <p className="label-mono text-accent-400">Nightly sync</p>
              <p className="mt-2 text-sm leading-snug text-paper-100/80">
                New roles arrive every morning at 05:00 UTC. Forwarded emails update your board as they land.
              </p>
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-[1280px]">{children}</div>
        </main>
      </body>
    </html>
  );
}
