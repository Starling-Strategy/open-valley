import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/schools" || request.nextUrl.pathname === "/api/schools") {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    return response;
  }
  // The public application does not serve the legacy private/admin/AI interfaces.
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: [
    "/schools",
    "/api/schools",
    "/admin/:path*",
    "/api/admin/:path*",
    "/awp(.*)",
    "/api/awp(.*)",
    "/chat/:path*",
    "/api/chat/:path*",
    "/copilotkit/:path*",
    "/api/copilotkit/:path*",
    "/api/api/admin/:path*",
    "/api/api/awp(.*)",
  ],
};
