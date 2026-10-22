"use client";

export default function PageError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="py-16 text-center text-sm">
      <p className="font-medium">Something didn&apos;t load.</p>
      <p className="mt-1 text-gray-500">Try again, and tell Shlok if it keeps happening.</p>
      <button
        onClick={() => retry()}
        className="mt-4 rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
      >
        Try again
      </button>
    </div>
  );
}
