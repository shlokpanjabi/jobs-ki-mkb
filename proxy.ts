import { NextResponse, type NextRequest } from "next/server";
import { boardAuthorized } from "@/lib/board-auth";

export function proxy(request: NextRequest) {
  if (boardAuthorized(request.headers.get("authorization"))) return NextResponse.next();
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Jobs ki mkb", charset="UTF-8"' },
  });
}

export const config = {
  // /api/jobs authenticates with per-user API keys instead, /api/cron with
  // CRON_SECRET (Vercel Cron can't send the board password) and
  // /api/inbound-email with Resend's webhook signature.
  matcher: ["/((?!api/jobs|api/cron|api/inbound-email|_next/static|_next/image|favicon.ico).*)"],
};
