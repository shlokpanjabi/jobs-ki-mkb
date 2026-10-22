"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { boardAuthorized } from "@/lib/board-auth";
import { isHomeRegion } from "@/lib/home-filter";
import { setHomeFilter } from "@/lib/jobs";
import { JOB_TYPES } from "@/lib/types";
import { USER_COOKIE } from "@/lib/user";

// Saves the "What shows on your board" checkboxes from Settings.
export async function saveHomeFilter(formData: FormData) {
  // Server actions are reachable by direct POST, so re-check the board password.
  if (!boardAuthorized((await headers()).get("authorization"))) throw new Error("Unauthorized");
  const userId = (await cookies()).get(USER_COOKIE)?.value;
  if (!userId) redirect("/settings");

  const regions = formData.getAll("region").map(String).filter(isHomeRegion);
  const types = formData.getAll("type").map(String).filter((t) => (JOB_TYPES as readonly string[]).includes(t));
  if (!regions.length || !types.length) redirect("/settings?home=empty");

  // Every type ticked is stored as null, so a type added later shows up too.
  await setHomeFilter(userId, regions, types.length === JOB_TYPES.length ? null : types);
  revalidatePath("/", "layout");
  redirect("/settings?home=saved");
}
