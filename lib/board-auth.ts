import { createHash, timingSafeEqual } from "node:crypto";

// When BOARD_PASSWORD is set, the board UI requires HTTP Basic auth with that
// password (any username). Unset means the board is open.
export function boardAuthorized(authorization: string | null): boolean {
  const password = process.env.BOARD_PASSWORD;
  if (!password) return true;
  if (!authorization?.startsWith("Basic ")) return false;

  const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon === -1) return false;
  return sameSecret(decoded.slice(colon + 1), password);
}

function sameSecret(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}
