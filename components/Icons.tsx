// Line icons, 1.6px stroke, drawn on a 24px grid. Decorative unless titled.
const PATHS = {
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  paw: "M7.5 10.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM16.5 10.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 11c-3 0-5.5 3.2-5.5 5.6 0 1.7 1.3 2.4 2.8 2.4 1 0 1.8-.5 2.7-.5s1.7.5 2.7.5c1.5 0 2.8-.7 2.8-2.4C17.5 14.2 15 11 12 11z",
  mail: "M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2.2.3-1.3-1.3.3-2.2-3-1-1 2h-1.6l-1-2-3 1 .3 2.2L6.2 7.3 4 7 3 10l2 1v2l-2 1 1 3 2.2-.3 1.3 1.3-.3 2.2 3 1 1-2h1.6l1 2 3-1-.3-2.2 1.3-1.3 2.2.3 1-3-2-1z",
  send: "M4 12 20 4l-5 16-3-7-8-1z",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18",
  trophy: "M8 4h8v4a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 3M16 6h3a3 3 0 0 1-3 3M12 12v4M8.5 20h7M10 16h4v4h-4z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  arrow: "M7 17 17 7M9 7h8v8",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className, title }: { name: IconName; size?: number; className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
