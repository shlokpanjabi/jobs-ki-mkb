import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { todayISO } from "@/lib/ingest/normalise.mjs";
import { audienceFor, parseProfiles } from "@/lib/ingest/profiles.mjs";
import { formatSummary, runIngest, selectSources } from "@/lib/ingest/run.mjs";
import { createStore, resolveUsers } from "@/lib/ingest/store.mjs";

// Sources are rate-limited, so a full run takes a minute or two.
export const maxDuration = 300;

// GET /api/cron/ingest: run by Vercel Cron daily (see vercel.json), which sends
// `Authorization: Bearer $CRON_SECRET`. Saves straight to the database.
// `?dryRun=1` returns the jobs it would save without saving them.
// Never log the request or its headers.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!bearer || !sameSecret(bearer, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = ["1", "true"].includes(new URL(request.url).searchParams.get("dryRun") ?? "");
  try {
    const sources = selectSources(process.env.INGEST_SOURCES);
    const profiles = parseProfiles();
    const users = await resolveUsers(db());
    const today = todayISO();
    const audience = Object.keys(profiles).length
      ? (job: Parameters<typeof audienceFor>[0], details: Parameters<typeof audienceFor>[1]) =>
          audienceFor(job, details, users, profiles, today)
      : undefined;
    const save = dryRun ? undefined : createStore(db(), users);
    const summary = await runIngest({ sources, dryRun, save, audience, today });
    console.log(`ingest summary\n${formatSummary(summary)}`);
    return Response.json(summary, { status: summary.ok ? 200 : 502 });
  } catch (err) {
    // Setup errors (missing DATABASE_URL, unknown source or user names, bad
    // INGEST_PROFILES). Message only: driver errors can carry query parameters.
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`GET /api/cron/ingest failed: ${message}`);
    return Response.json({ error: "Ingest failed to start", details: message }, { status: 500 });
  }
}

function sameSecret(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}
