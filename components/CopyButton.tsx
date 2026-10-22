"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (e.g. insecure context): the address is still selectable.
        }
      }}
      className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
