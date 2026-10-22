// Applies the SQL files in db/ using DATABASE_URL (loaded from .env.local like Next does).
// Usage: node scripts/db.mjs <migrate|seed|setup>
import { readFile } from "node:fs/promises";
import { INBOUND_SCHEMA } from "../lib/inbound/schema.mjs";
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
    if (file === "db/schema.sql") {
      // Email status sync tables; kept in JS so the app can also apply them itself.
      await sql.unsafe(INBOUND_SCHEMA).simple();
      console.log("Applied lib/inbound/schema.mjs");
    }
  }
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
