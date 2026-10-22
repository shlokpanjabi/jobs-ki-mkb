import { Suspense } from "react";
import { BoardSection, BoardFallback } from "@/components/BoardSection";

export default function AllRolesPage() {
  return (
    <Suspense fallback={<BoardFallback />}>
      <BoardSection />
    </Suspense>
  );
}
