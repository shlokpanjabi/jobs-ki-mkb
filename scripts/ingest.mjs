// Fetches jobs from every source in lib/ingest/ and POSTs them to /api/jobs.
// Reads INGEST_BASE_URL and INGEST_API_KEY from .env.local like Next does.
//
//   npm run ingest                              # all sources
//   npm run ingest -- --dry-run                 # print what would be posted, write nothing
//   npm run ingest -- --source=gradcracker,luma # only these sources
import nextEnv from "@next/env";
import { formatSummary, ingestConfigFromEnv, runIngest } from "../lib/ingest/run.mjs";

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

try {
  const config = ingestConfigFromEnv({ sources: sourceArg });
  const summary = await runIngest({ ...config, dryRun });
  console.log(`\n${formatSummary(summary)}`);
  if (!summary.ok) process.exitCode = 1;
} catch (err) {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
}
