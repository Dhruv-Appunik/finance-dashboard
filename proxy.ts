import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optional password. When APP_PASSWORD is set, the browser asks for it once
 * (any username). Leave it unset if the app only runs on your own computer.
 */
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      if (decoded.slice(decoded.indexOf(":") + 1) === password) return NextResponse.next();
    } catch {
      // fall through to the challenge
    }
  }
  return new NextResponse("Password required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Finance Dashboard"' } });
}

export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico).*)" };
