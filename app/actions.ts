"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { boardAuthorized } from "@/lib/board-auth";
import { getUsers, setStatus } from "@/lib/jobs";
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
