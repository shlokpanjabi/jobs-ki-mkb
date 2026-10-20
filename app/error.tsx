"use client";

export default function BoardError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="py-16 text-center text-sm">
      <p className="font-medium">Couldn&apos;t load the board.</p>
      <p className="mt-1 text-gray-500">
        Check that DATABASE_URL is set and the schema is applied (<code>npm run db:migrate</code>).
      </p>
      <button
        onClick={() => retry()}
        className="mt-4 rounded border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
      >
        Try again
      </button>
    </div>
  );
}
