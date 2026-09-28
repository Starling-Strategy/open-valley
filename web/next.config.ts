import type { NextConfig } from "next";

const publicApiVariable = "NEXT_PUBLIC_BASELINE_API_URL";

if (process.env[publicApiVariable]) {
  throw new Error(
    `${publicApiVariable} is not supported. Browser requests must use same-origin /api/baseline routes.`,
  );
}

const nextConfig: NextConfig = {
  output: "standalone",
  // This value is evaluated by the Next.js server only. Browser code continues
  // to request relative /api/baseline paths.
  async rewrites() {
    const baselineApiUrl = process.env.INTERNAL_BASELINE_API_URL || "http://localhost:8998";
    return [
      {
        source: "/healthz",
        destination: `${baselineApiUrl}/healthz`,
      },
      {
        source: "/api/baseline/:path*",
        destination: `${baselineApiUrl}/api/baseline/:path*`,
      },
    ];
  },
};

export default nextConfig;
