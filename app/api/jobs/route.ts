import { userForRequest } from "@/lib/api-keys";
import { parseJobInput, upsertJobForUser } from "@/lib/jobs";

const MAX_BODY_BYTES = 16_384;

// POST /api/jobs: upsert a job (deduped by link) and mark it eligible for the
// API key's owner. Never log the request or its headers: they carry the key.
export async function POST(request: Request) {
  let userId: string | null;
  try {
    userId = await userForRequest(request);
  } catch (err) {
    return serverError("auth lookup", err);
  }
  if (!userId) {
    return Response.json(
      { error: "Unauthorized: send a valid key as 'Authorization: Bearer <key>'" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return Response.json({ error: "Body too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const parsed = parseJobInput(body);
  if ("errors" in parsed) {
    return Response.json({ error: "Invalid job", details: parsed.errors }, { status: 400 });
  }

  try {
    const { id, created } = await upsertJobForUser(parsed.job, userId);
    return Response.json(
      { id, created, eligibleFor: userId, link: parsed.job.link },
      { status: created ? 201 : 200 },
    );
  } catch (err) {
    return serverError("upsert", err);
  }
}

function serverError(step: string, err: unknown) {
  // Message only: error objects from the driver can carry query parameters.
  console.error(`POST /api/jobs ${step} failed: ${err instanceof Error ? err.message : "unknown error"}`);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
