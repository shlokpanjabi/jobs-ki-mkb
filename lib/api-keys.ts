import { createHash } from "node:crypto";
import { db } from "./db";

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// Reads the key from `Authorization: Bearer <key>` or `X-API-Key`, never from
// the URL (URLs end up in access logs). Returns the owner's user id, or null for
// a missing or unknown key. The key itself is never logged or stored.
export async function userForRequest(request: Request): Promise<string | null> {
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const key = bearer ?? request.headers.get("x-api-key")?.trim();
  if (!key || key.length > 200) return null;

  const rows = await db()<{ user_id: string }[]>`
    update api_keys set last_used_at = now()
    where key_hash = ${hashKey(key)}
    returning user_id`;
  return rows[0]?.user_id ?? null;
}
