import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardFallback } from "@/components/BoardSection";
import { PetDex } from "@/components/PetDex";

export const metadata: Metadata = { title: "Pet Dex · Apply Tracker" };

export default function PetsPage() {
  return (
    <Suspense fallback={<BoardFallback />}>
      <PetDex />
    </Suspense>
  );
}
