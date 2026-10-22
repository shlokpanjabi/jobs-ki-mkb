// Fetches jobs from every source in lib/ingest/ and upserts them into the
// database (DATABASE_URL, loaded from .env.local like Next does).
//
//   npm run ingest                              # all sources
//   npm run ingest -- --dry-run                 # print what would be saved, write nothing
//   npm run ingest -- --source=simplify,luma    # only these sources
import nextEnv from "@next/env";
import { todayISO } from "../lib/ingest/normalise.mjs";
import { audienceFor, parseProfiles } from "../lib/ingest/profiles.mjs";
import { formatSummary, runIngest, selectSources } from "../lib/ingest/run.mjs";
import { createStore, resolveUsers } from "../lib/ingest/store.mjs";
import { connect } from "./connect.mjs";

nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sourceArg = args.find((a) => a.startsWith("--source="))?.slice("--source=".length);
const unknownFlags = args.filter((a) => a !== "--dry-run" && !a.startsWith("--source="));
if (unknownFlags.length) {
  console.error(`Unknown argument(s): ${unknownFlags.join(" ")}`);
  console.error("Usage: node scripts/ingest.mjs [--dry-run] [--source=simplify,sheets,...]");
  process.exit(1);
}

const sql = dryRun ? null : connect();
try {
  const sources = selectSources(sourceArg ?? process.env.INGEST_SOURCES);
  const profiles = parseProfiles();
  // Without a database (dry run), the profiles' users stand in for the users table.
  const users = sql ? await resolveUsers(sql) : Object.keys(profiles);
  const today = todayISO();
  const audience = users.length && Object.keys(profiles).length
    ? (job, details) => audienceFor(job, details, users, profiles, today)
    : undefined;
  console.log(`Users: ${users.join(", ") || "(none)"}; profiles for: ${Object.keys(profiles).join(", ") || "nobody (everyone sees everything)"}`);
  const save = sql ? createStore(sql, users) : undefined;
  const summary = await runIngest({ sources, dryRun, save, audience, today });
  console.log(`\n${formatSummary(summary)}`);
  if (!summary.ok) process.exitCode = 1;
} catch (err) {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await sql?.end();
}
