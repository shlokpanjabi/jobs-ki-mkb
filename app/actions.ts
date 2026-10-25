"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { boardAuthorized } from "@/lib/board-auth";
import { db } from "@/lib/db";
import { closeAction } from "@/lib/inbound/db.mjs";
import { addRoleByHand, getUsers, setStatus } from "@/lib/jobs";
import { isStatus, type Status } from "@/lib/types";
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
  | { status: "done"; outcome: "added" | "attached" | "exists"; role: string; company: string; userName: string };

const ADD_ROLE_FIELDS = ["company", "role", "type", "link", "location", "region", "domain", "deadline", "source"] as const;

// "Add role" form on the board. Writes only to the board of the person in
// "Viewing as" (the cookie), and only if that's still who the form was showing
// (`for`): switching user in another tab can't send a role to the wrong board.
export async function addRole(_prev: AddRoleState, formData: FormData): Promise<AddRoleState> {
  await assertBoardAccess();
  const userId = (await cookies()).get(USER_COOKIE)?.value;
  const users = await getUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return { status: "error", errors: ["Pick who you are first."] };
  const target = String(formData.get("for") ?? "");
  if (target !== user.id) {
    const shown = users.find((u) => u.id === target)?.name ?? "someone else";
    return {
      status: "error",
      errors: [`This form was for ${shown}, but you're now viewing as ${user.name}. Reload the page and try again.`],
    };
  }

  const body: Record<string, unknown> = {};
  for (const field of ADD_ROLE_FIELDS) body[field] = String(formData.get(field) ?? "");
  const result = await addRoleByHand(user.id, body);
  if (!result.ok) return { status: "error", errors: result.errors };
  if (result.outcome !== "exists") revalidatePath("/", "layout");
  return { status: "done", outcome: result.outcome, role: String(body.role).trim(), company: String(body.company).trim(), userName: user.name };
}
