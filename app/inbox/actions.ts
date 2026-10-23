"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { boardAuthorized } from "@/lib/board-auth";
import { db } from "@/lib/db";
import { LABELS } from "@/lib/inbound/classify.mjs";
import { addJobFromEmail, dismissEvent, matchManually } from "@/lib/inbound/db.mjs";
import { JOB_TYPES } from "@/lib/types";
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

// "Add to board as Applied": the person types (or corrects) company and role;
// nothing is inferred from the sender.
export async function addToBoardFromInbox(formData: FormData) {
  const userId = await currentUser();
  const eventId = Number(formData.get("event"));
  const field = (name: string) => String(formData.get(name) ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
  const company = field("company");
  const role = field("role");
  const type = field("type");
  if (!Number.isInteger(eventId) || !company || !role) redirect("/inbox?error=add");
  if (!(JOB_TYPES as readonly string[]).includes(type)) redirect("/inbox?error=add");
  const added = await addJobFromEmail(db(), userId, eventId, { company, role, type });
  revalidatePath("/", "layout");
  if (!added) redirect("/inbox?error=job");
  redirect(`/inbox?added=${added.reused ? "existing" : "new"}`);
}
