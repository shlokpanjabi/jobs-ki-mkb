import type { Metadata } from "next";
import { Suspense } from "react";
import { EmailSyncFallback, SettingsSection } from "@/components/EmailSync";

export const metadata: Metadata = { title: "Settings · Apply Tracker" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<EmailSyncFallback />}>
      <SettingsSection />
    </Suspense>
  );
}
