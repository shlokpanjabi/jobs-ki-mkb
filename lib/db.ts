import postgres from "postgres";

const globalForDb = globalThis as typeof globalThis & { sql?: postgres.Sql };

// Lazily created so `next build` works without DATABASE_URL, and reused across
// hot reloads and warm serverless invocations.
export function db(): postgres.Sql {
  if (!globalForDb.sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.sql = postgres(url, {
      prepare: false, // required by Supabase's transaction pooler (port 6543)
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return globalForDb.sql;
}
