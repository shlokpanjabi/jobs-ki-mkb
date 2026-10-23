import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

// A tight grotesk for everything, set large for titles; mono for small labels.
const interTight = Inter_Tight({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter-tight" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "Apply Tracker",
  description: "Shared board of internships, part-time jobs, fellowships and hackathons, with pets that grow as you apply.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <header className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 pb-4 pt-6">
            <Link href="/" className="title-outline text-[28px] leading-none sm:text-[32px]">
              Apply Tracker<span className="text-accent-500">.</span>
            </Link>
            <NavLinks />
          </div>
          <div className="checker-band" />
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
