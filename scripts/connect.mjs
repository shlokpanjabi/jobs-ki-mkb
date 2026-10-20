import nextEnv from "@next/env";
import postgres from "postgres";

export function connect() {
  nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Put it in .env.local (see .env.example).");
    process.exit(1);
  }
  return postgres(url, { prepare: false, max: 1, onnotice() {} });
}
