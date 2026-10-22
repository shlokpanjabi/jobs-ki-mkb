import { JOB_TYPES, type JobType } from "./types";

// What each person sees on their board by default, saved on their user row and
// edited on Settings. Keys are stored; the regions are the board's region labels
// (lib/ingest/normalise.mjs). "other" covers any other region and jobs with no
// location.
export const HOME_REGIONS = [
  { key: "uk", label: "UK (London and elsewhere)", regions: ["London", "UK (outside London)"] },
  { key: "europe", label: "Europe", regions: ["Europe"] },
  { key: "remote", label: "Remote", regions: ["Remote"] },
  { key: "us", label: "US", regions: ["US"] },
  { key: "canada", label: "Canada", regions: ["Canada"] },
  { key: "india", label: "India", regions: ["India"] },
  { key: "pakistan", label: "Pakistan", regions: ["Pakistan"] },
  { key: "asia", label: "Asia", regions: ["Asia"] },
  { key: "australia", label: "Australia and New Zealand", regions: ["Australia"] },
  { key: "other", label: "Anywhere else, or no location given", regions: [] },
] as const;

export type HomeRegionKey = (typeof HOME_REGIONS)[number]["key"];
export const DEFAULT_HOME_REGIONS: HomeRegionKey[] = ["uk", "europe", "remote"];

export const TYPE_PLURAL: Record<JobType, string> = {
  internship: "internships",
  "part-time": "part-time jobs",
  fellowship: "fellowships",
  hackathon: "hackathons",
};

export function isHomeRegion(value: string): value is HomeRegionKey {
  return HOME_REGIONS.some((r) => r.key === value);
}

/** "UK, Europe and Remote roles" style summary for the board. */
export function describeHome(regions: string[], types: string[] | null): string {
  const places = HOME_REGIONS.filter((r) => regions.includes(r.key)).map((r) =>
    r.key === "other" ? "other places" : r.key === "uk" ? "UK" : r.label,
  );
  const kinds = types === null || JOB_TYPES.every((t) => types.includes(t))
    ? "roles"
    : JOB_TYPES.filter((t) => types.includes(t)).map((t) => TYPE_PLURAL[t]).join(", ");
  const list = places.length > 1 ? `${places.slice(0, -1).join(", ")} and ${places.at(-1)}` : places[0] ?? "no";
  return `${list} ${kinds}`;
}
