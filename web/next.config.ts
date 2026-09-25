import type { NextConfig } from "next";

const publicApiVariable = "NEXT_PUBLIC_BASELINE_API_URL";

if (process.env[publicApiVariable]) {
  throw new Error(
    `${publicApiVariable} is not supported. Browser requests must use same-origin /api/baseline routes.`,
  );
}

const nextConfig: NextConfig = {
  // This value is evaluated by the Next.js server only. Browser code continues
  // to request relative /api/baseline paths.
  async rewrites() {
    const baselineApiUrl = process.env.INTERNAL_BASELINE_API_URL || "http://localhost:8998";
    return [
      {
        source: "/api/baseline/:path*",
        destination: `${baselineApiUrl}/api/baseline/:path*`,
      },
      {
        // Readiness of the release API, for the web health check and the
        // container health check. The API itself stays loopback-only.
        source: "/healthz",
        destination: `${baselineApiUrl}/healthz`,
      },
    ];
  },
};

export default nextConfig;
