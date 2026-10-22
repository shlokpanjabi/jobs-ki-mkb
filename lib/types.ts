export const JOB_TYPES = ["internship", "part-time", "fellowship", "hackathon"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const STATUSES = ["todo", "applied", "rejected", "offer"] as const;
export type Status = (typeof STATUSES)[number];

// homeRegions: keys from lib/home-filter.ts. homeTypes: null means every type.
export type User = { id: string; name: string; homeRegions: string[]; homeTypes: string[] | null };

// A job as seen by one user on the board.
export type BoardRow = {
  id: number;
  company: string;
  role: string;
  type: JobType;
  domain: string | null;
  location: string | null;
  region: string | null;
  deadline: string | null; // YYYY-MM-DD, null = rolling
  source: string | null; // every source listing this job, comma-separated
  link: string;
  status: Status;
};

export function isStatus(value: unknown): value is Status {
  return STATUSES.includes(value as Status);
}
