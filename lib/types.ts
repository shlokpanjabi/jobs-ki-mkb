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
  link: string | null; // null for jobs added from an email: no posting
  status: Status;
  stage: Stage | null; // furthest invitation seen; never means it was completed
  actions: BoardAction[]; // open actions from emails, soonest first
};

export const STAGES = ["assessment_invited", "interview_invited"] as const;
export type Stage = (typeof STAGES)[number];

export const ACTION_KINDS = ["complete_assessment", "book_interview", "attend_interview"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

// Something an email asked the person to do for one application. The due
// date, time and zone are as the email stated them (time only with a zone).
export type BoardAction = {
  id: number;
  kind: ActionKind;
  dueDate: string | null; // YYYY-MM-DD
  dueTime: string | null; // HH:MM, in dueTz
  dueTz: string | null;
  reminders: number;
  // The email that last asked for it, to find in Gmail.
  email: { subject: string; senderDomain: string | null; messageId: string | null } | null;
};

export function isStatus(value: unknown): value is Status {
  return STATUSES.includes(value as Status);
}
