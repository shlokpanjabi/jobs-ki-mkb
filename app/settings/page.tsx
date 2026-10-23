import type { Metadata } from "next";
import { Suspense } from "react";
import { EmailSyncFallback, SettingsSection } from "@/components/EmailSync";

export const metadata: Metadata = { title: "Settings · Apply Tracker" };

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <Suspense fallback={<EmailSyncFallback />}>
      <SettingsWithParams searchParams={searchParams} />
    </Suspense>
  );
}

async function SettingsWithParams({ searchParams }: { searchParams: PageProps<"/settings">["searchParams"] }) {
  const { home, gmail } = await searchParams;
  return (
    <SettingsSection
      homeNotice={home === "saved" || home === "empty" ? home : undefined}
      gmailNotice={gmail === "saved" || gmail === "cleared" || gmail === "invalid" ? gmail : undefined}
    />
  );
}
