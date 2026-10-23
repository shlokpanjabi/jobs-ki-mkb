"use client";

import { Pet } from "@/components/Pet";

export default function PageError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex flex-col items-center py-12 text-center">
      <Pet species="volt" form={0} id="error-pet" size={120} title="A puzzled pet" />
      <p className="font-display font-semibold text-cocoa-900">Something didn&apos;t load.</p>
      <p className="mt-1 font-semibold text-cocoa-500">Try again, and tell Shlok if it keeps happening.</p>
      <button
        onClick={() => retry()}
        className="btn-3d btn-carrot mt-4 px-4 py-1.5"
      >
        Try again
      </button>
    </div>
  );
}
