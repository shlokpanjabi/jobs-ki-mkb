export const JOB_TYPES = ["internship", "part-time", "fellowship"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const STATUSES = ["todo", "applied", "rejected", "offer"] as const;
export type Status = (typeof STATUSES)[number];

export type User = { id: string; name: string };

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
  source: string | null;
  link: string;
  status: Status;
};

export function isStatus(value: unknown): value is Status {
  return STATUSES.includes(value as Status);
}
