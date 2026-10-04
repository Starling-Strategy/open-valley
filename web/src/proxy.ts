// The public application does not serve the legacy private/admin/AI interfaces.
export function proxy() {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const config = {
  matcher: [
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
