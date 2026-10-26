"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { boardAuthorized } from "@/lib/board-auth";
import { db } from "@/lib/db";
import { ELIGIBILITY_USERS } from "@/lib/eligibility.mjs";
import { closeAction } from "@/lib/inbound/db.mjs";
import { addRoleByHand, getUsers, setEligibility, setStage, setStatus, STAGE_CONTROL_USERS } from "@/lib/jobs";
import { isStage, isStatus, isVerdict, type Stage, type Status, type Verdict } from "@/lib/types";
import { USER_COOKIE } from "@/lib/user";

// Server actions are reachable by direct POST, so re-check the board password
// here instead of relying on the proxy alone.
async function assertBoardAccess() {
  if (!boardAuthorized((await headers()).get("authorization"))) {
    throw new Error("Unauthorized");
  }
}

export async function switchUser(formData: FormData) {
  await assertBoardAccess();
  const userId = String(formData.get("user") ?? "");
  const users = await getUsers();
  if (!users.some((u) => u.id === userId)) return;

  // Setting a cookie re-renders the current page in the same round trip.
  (await cookies()).set(USER_COOKIE, userId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function updateStatus(
  jobId: number,
  status: Status,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertBoardAccess();
  const userId = (await cookies()).get(USER_COOKIE)?.value;
  if (!userId) return { ok: false, error: "Pick who you are first." };
  if (!Number.isInteger(jobId) || !isStatus(status)) return { ok: false, error: "Invalid update." };

  const updated = await setStatus(userId, jobId, status);
  // Purges the client router cache so every page shows the change.
  revalidatePath("/", "layout");
  return updated ? { ok: true } : { ok: false, error: "That role is no longer on your board." };
}

// Stage on the board ("none" clears it), for the person in "Viewing as", if
// they can set it by hand (STAGE_CONTROL_USERS).
export async function updateStage(
  jobId: number,
  stage: Stage | "none",
): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertBoardAccess();
  const userId = (await cookies()).get(USER_COOKIE)?.value;
  if (!userId) return { ok: false, error: "Pick who you are first." };
  if (!Number.isInteger(jobId) || !(stage === "none" || isStage(stage))) return { ok: false, error: "Invalid update." };
  if (!STAGE_CONTROL_USERS.includes(userId)) return { ok: false, error: "Setting the stage isn't on for this board." };

  const updated = await setStage(userId, jobId, stage === "none" ? null : stage);
  revalidatePath("/", "layout");
  return updated ? { ok: true } : { ok: false, error: "That role is no longer on your board." };
}

// Eligibility on the board ("unknown" clears it), for the person in "Viewing
// as" only, and only if they have eligibility verdicts (ELIGIBILITY_USERS).
export async function updateEligibility(
  jobId: number,
  verdict: Verdict | "unknown",
): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertBoardAccess();
  const userId = (await cookies()).get(USER_COOKIE)?.value;
  if (!userId) return { ok: false, error: "Pick who you are first." };
  if (!Number.isInteger(jobId) || !(verdict === "unknown" || isVerdict(verdict))) return { ok: false, error: "Invalid update." };
  if (!ELIGIBILITY_USERS.includes(userId)) return { ok: false, error: "Eligibility isn't on for this board." };

  const updated = await setEligibility(userId, jobId, verdict === "unknown" ? null : verdict);
  revalidatePath("/", "layout");
  return updated ? { ok: true } : { ok: false, error: "That role is no longer on your board." };
}

// Done / Dismiss on an action under a job's status.
export async function updateAction(
  actionId: number,
  state: "done" | "dismissed",
): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertBoardAccess();
  const userId = (await cookies()).get(USER_COOKIE)?.value;
  if (!userId) return { ok: false, error: "Pick who you are first." };
  if (!Number.isInteger(actionId) || (state !== "done" && state !== "dismissed")) return { ok: false, error: "Invalid update." };
  const closed = await closeAction(db(), userId, actionId, state);
  revalidatePath("/", "layout");
  return closed ? { ok: true } : { ok: false, error: "That action was already closed." };
}

export type AddRoleState =
  | { status: "idle" }
  | { status: "error"; errors: string[] }
  | {
      status: "done";
      outcome: "added" | "attached" | "exists";
      role: string;
      company: string;
      addedFor: string[];
      alreadyOn: string[];
    };

const ADD_ROLE_FIELDS = ["company", "role", "type", "link", "location", "region", "domain", "deadline", "source"] as const;

// "Add role" form on the board. Adds the role to everyone's board (boards that
// already have the link are left as they are).
export async function addRole(_prev: AddRoleState, formData: FormData): Promise<AddRoleState> {
  await assertBoardAccess();
  const body: Record<string, unknown> = {};
  for (const field of ADD_ROLE_FIELDS) body[field] = String(formData.get(field) ?? "");
  const result = await addRoleByHand(body);
  if (!result.ok) return { status: "error", errors: result.errors };
  if (result.outcome !== "exists") revalidatePath("/", "layout");
  return {
    status: "done",
    outcome: result.outcome,
    role: String(body.role).trim(),
    company: String(body.company).trim(),
    addedFor: result.addedFor,
    alreadyOn: result.alreadyOn,
  };
}
