// Generates one API key per user. Only the SHA-256 hash is stored; the key is
// printed once and can't be recovered afterwards.
//
//   npm run keys                    # users who don't have a key yet
//   npm run keys -- --rotate        # replace every user's key
//   npm run keys -- --rotate shlok  # replace one user's key
import { createHash, randomBytes } from "node:crypto";
import { connect } from "./connect.mjs";

const args = process.argv.slice(2);
const rotate = args.includes("--rotate");
const only = args.filter((a) => !a.startsWith("--"));

const sql = connect();
try {
  const users = await sql`
    select u.id, count(k.id)::int as key_count
    from users u left join api_keys k on k.user_id = u.id
    group by u.id order by u.id`;

  const unknown = only.filter((id) => !users.some((u) => u.id === id));
  if (unknown.length) throw new Error(`Unknown user(s): ${unknown.join(", ")}`);

  const issued = [];
  for (const user of users) {
    if (only.length && !only.includes(user.id)) continue;
    if (user.key_count > 0 && !rotate) {
      console.log(`Skipped ${user.id}: already has a key (use --rotate to replace it)`);
      continue;
    }
    const key = `atk_${randomBytes(32).toString("base64url")}`;
    const hash = createHash("sha256").update(key).digest("hex");
    await sql.begin(async (tx) => {
      await tx`delete from api_keys where user_id = ${user.id}`;
      await tx`insert into api_keys (user_id, key_hash) values (${user.id}, ${hash})`;
    });
    issued.push([user.id, key]);
  }

  if (issued.length) {
    console.log("\nNew API keys (shown once, not stored; copy them now):\n");
    for (const [id, key] of issued) console.log(`  ${id.padEnd(10)} ${key}`);
    console.log("");
  }
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
