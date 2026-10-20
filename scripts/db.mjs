// Applies the SQL files in db/ using DATABASE_URL (loaded from .env.local like Next does).
// Usage: node scripts/db.mjs <migrate|seed|setup>
import { readFile } from "node:fs/promises";
import { connect } from "./connect.mjs";

const FILES = {
  migrate: ["db/schema.sql"],
  seed: ["db/seed.sql"],
  setup: ["db/schema.sql", "db/seed.sql"],
};

const command = process.argv[2];
if (!FILES[command]) {
  console.error("Usage: node scripts/db.mjs <migrate|seed|setup>");
  process.exit(1);
}

const sql = connect();
try {
  for (const file of FILES[command]) {
    // .simple() allows multiple statements per file.
    await sql.unsafe(await readFile(file, "utf8")).simple();
    console.log(`Applied ${file}`);
  }
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
