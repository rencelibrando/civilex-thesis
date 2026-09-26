import type { NextConfig } from "next";

const backendUrl =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:4000";

const nextConfig: NextConfig = {
  // Output standalone build for containers when explicitly requested
  output: process.env.BUILD_STANDALONE === "true" ? "standalone" : undefined,

  // Rewrites support for proxying api requests if needed
  async rewrites() {
    return [
      {
        source: "/api/gateway/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
