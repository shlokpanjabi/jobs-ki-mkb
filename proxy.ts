import { NextResponse, type NextRequest } from "next/server";
import { boardAuthorized } from "@/lib/board-auth";

export function proxy(request: NextRequest) {
  if (boardAuthorized(request.headers.get("authorization"))) return NextResponse.next();
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Apply Tracker", charset="UTF-8"' },
  });
}

export const config = {
  // /api/jobs authenticates with per-user API keys instead, and /api/cron with
  // CRON_SECRET (Vercel Cron can't send the board password).
  matcher: ["/((?!api/jobs|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
