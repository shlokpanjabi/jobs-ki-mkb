import { Resend } from "resend";
import { db } from "@/lib/db";
import { createLlmClassifier } from "@/lib/inbound/llm.mjs";
import { processInboundEvent } from "@/lib/inbound/process.mjs";

// Resend fetch plus, rarely, one classifier call.
export const maxDuration = 60;

// POST /api/inbound-email: Resend inbound webhook (`email.received`). The
// request is signed (svix-id / svix-timestamp / svix-signature) with
// RESEND_WEBHOOK_SECRET. `INBOUND_DRY_RUN=1` or `?dryRun=1` classifies and
// matches without writing anything and returns the decision.
// Never log the request, its headers or the email body.
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  if (!secret || !apiKey) {
    return Response.json({ error: "RESEND_WEBHOOK_SECRET and RESEND_API_KEY must be set" }, { status: 503 });
  }

  const payload = await request.text();
  const resend = new Resend(apiKey);
  let event;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret: secret,
    });
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const dryRun =
    ["1", "true"].includes(process.env.INBOUND_DRY_RUN ?? "") ||
    ["1", "true"].includes(new URL(request.url).searchParams.get("dryRun") ?? "");
  try {
    const result = await processInboundEvent({
      sql: db(),
      event,
      fetchEmail: async (id) => {
        const { data, error } = await resend.emails.receiving.get(id);
        if (error || !data) throw new Error(`Resend received-email fetch failed: ${error?.name ?? "no data"}`);
        return data;
      },
      llm: createLlmClassifier(),
      dryRun,
    });
    return Response.json(result);
  } catch (err) {
    // A 5xx makes Resend retry, which suits transient failures. Message only:
    // driver errors can carry query parameters.
    console.error(`POST /api/inbound-email failed: ${err instanceof Error ? err.message : "unknown error"}`);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
