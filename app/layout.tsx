import type { Metadata } from "next";
import { NavLinks } from "@/components/NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  title: "Apply Tracker",
  description: "Shared board of internships, part-time jobs and fellowships.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <header className="border-b border-gray-200">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <span className="font-semibold">Apply Tracker</span>
            <NavLinks />
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-4">{children}</main>
      </body>
    </html>
  );
}
