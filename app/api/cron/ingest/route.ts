import { createHash, timingSafeEqual } from "node:crypto";
import { formatSummary, ingestConfigFromEnv, runIngest } from "@/lib/ingest/run.mjs";

// Sources are rate-limited, so a full run takes a minute or two.
export const maxDuration = 300;

// GET /api/cron/ingest: run by Vercel Cron daily (see vercel.json), which sends
// `Authorization: Bearer $CRON_SECRET`. `?dryRun=1` returns the jobs it would
// post without posting them. Never log the request or its headers.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!bearer || !sameSecret(bearer, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = ["1", "true"].includes(url.searchParams.get("dryRun") ?? "");
  try {
    // Posts to this deployment's own /api/jobs unless INGEST_BASE_URL says otherwise.
    const config = ingestConfigFromEnv({ baseUrl: url.origin });
    const summary = await runIngest({ ...config, dryRun });
    console.log(`ingest summary\n${formatSummary(summary)}`);
    return Response.json(summary, { status: summary.ok ? 200 : 502 });
  } catch (err) {
    // Config errors only (missing env vars, unknown source names); no secrets.
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`GET /api/cron/ingest failed: ${message}`);
    return Response.json({ error: "Ingest failed to start", details: message }, { status: 500 });
  }
}

function sameSecret(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}
