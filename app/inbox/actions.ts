"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { boardAuthorized } from "@/lib/board-auth";
import { db } from "@/lib/db";
import { LABELS } from "@/lib/inbound/classify.mjs";
import { dismissEvent, matchManually } from "@/lib/inbound/db.mjs";
import { USER_COOKIE } from "@/lib/user";

// Server actions are reachable by direct POST, so re-check the board password
// here instead of relying on the proxy alone.
async function currentUser(): Promise<string> {
  if (!boardAuthorized((await headers()).get("authorization"))) throw new Error("Unauthorized");
  const userId = (await cookies()).get(USER_COOKIE)?.value;
  if (!userId) redirect("/inbox");
  return userId;
}

// The job field is "<company> — <role> · #<id>", picked from the datalist.
export async function matchFromInbox(formData: FormData) {
  const userId = await currentUser();
  const eventId = Number(formData.get("event"));
  const label = String(formData.get("label") ?? "");
  const jobId = Number(/#(\d+)\s*$/.exec(String(formData.get("job") ?? ""))?.[1]);
  if (!Number.isInteger(eventId) || !LABELS.includes(label)) redirect("/inbox?error=label");
  if (!Number.isInteger(jobId)) redirect("/inbox?error=job");
  const ok = await matchManually(db(), userId, eventId, jobId, label);
  revalidatePath("/", "layout");
  if (!ok) redirect("/inbox?error=job");
}

export async function dismissFromInbox(formData: FormData) {
  const userId = await currentUser();
  const eventId = Number(formData.get("event"));
  if (Number.isInteger(eventId)) await dismissEvent(db(), userId, eventId);
  revalidatePath("/inbox");
}
