// Fetches jobs from every source in lib/ingest/ and upserts them into the
// database (DATABASE_URL, loaded from .env.local like Next does).
//
//   npm run ingest                              # all sources
//   npm run ingest -- --dry-run                 # print what would be saved, write nothing
//   npm run ingest -- --source=gradcracker,luma # only these sources
import nextEnv from "@next/env";
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
  console.error("Usage: node scripts/ingest.mjs [--dry-run] [--source=gradcracker,indeed-uk,luma]");
  process.exit(1);
}

const sql = dryRun ? null : connect();
try {
  const sources = selectSources(sourceArg ?? process.env.INGEST_SOURCES);
  let save;
  if (sql) {
    const users = await resolveUsers(sql);
    console.log(`Saving jobs as eligible for: ${users.join(", ")}`);
    save = createStore(sql, users);
  }
  const summary = await runIngest({ sources, dryRun, save });
  console.log(`\n${formatSummary(summary)}`);
  if (!summary.ok) process.exitCode = 1;
} catch (err) {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await sql?.end();
}
