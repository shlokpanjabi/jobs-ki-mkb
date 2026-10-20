const DAY_MS = 86_400_000;

// Today's date (YYYY-MM-DD) in APP_TIMEZONE. Computed on the server and passed
// down so server and client agree on what "closing in 7 days" means.
export function todayISO(): string {
  const timeZone = process.env.APP_TIMEZONE || "UTC";
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

// Whole days from `from` to `to`, both YYYY-MM-DD.
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
