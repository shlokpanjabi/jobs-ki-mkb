import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardSection, BoardFallback } from "@/components/BoardSection";

export const metadata: Metadata = { title: "Closing in 7 days · Apply Tracker" };

export default function ClosingSoonPage() {
  return (
    <Suspense fallback={<BoardFallback />}>
      <BoardSection view="closing" />
    </Suspense>
  );
}
