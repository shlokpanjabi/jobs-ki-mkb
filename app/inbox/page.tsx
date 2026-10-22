import type { Metadata } from "next";
import { Suspense } from "react";
import { EmailSyncFallback, InboxSection } from "@/components/EmailSync";

export const metadata: Metadata = { title: "Email matches · Apply Tracker" };

export default function InboxPage({ searchParams }: PageProps<"/inbox">) {
  return (
    <Suspense fallback={<EmailSyncFallback />}>
      <InboxWithParams searchParams={searchParams} />
    </Suspense>
  );
}

async function InboxWithParams({ searchParams }: { searchParams: PageProps<"/inbox">["searchParams"] }) {
  const { error } = await searchParams;
  return <InboxSection error={typeof error === "string" ? error : undefined} />;
}
