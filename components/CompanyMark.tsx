// A monogram tile standing in for a company logo: up to two initials on a
// muted tone picked from the name, so the same company always looks the same.
const TONES = [
  "bg-[#e9e2d6] text-[#5b4a32]",
  "bg-[#dfe6ee] text-[#2f4a6b]",
  "bg-[#e3ebe1] text-[#34553a]",
  "bg-[#ece3ec] text-[#5c3a5c]",
  "bg-[#f1e1d9] text-[#7a3a22]",
  "bg-[#e1e8e8] text-[#2f5656]",
  "bg-[#ebe8d8] text-[#5a5528]",
  "bg-[#e6e2f0] text-[#463c78]",
];

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s&]/gu, " ").split(/\s+/).filter((w) => w && w !== "&");
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function toneFor(name: string): string {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

export function CompanyMark({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center rounded-lg font-mono font-medium tracking-tight ${toneFor(name)}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials(name)}
    </span>
  );
}
