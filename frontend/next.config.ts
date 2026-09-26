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
      {
        source: "/api/civil-code/:path*",
        destination: `${backendUrl}/api/civil-code/:path*`,
      },
      {
        source: "/api/sessions/:path*",
        destination: `${backendUrl}/api/sessions/:path*`,
      },
      {
        source: "/api/documents/:path*",
        destination: `${backendUrl}/api/documents/:path*`,
      },
      {
        source: "/api/profiles/:path*",
        destination: `${backendUrl}/api/profiles/:path*`,
      },
      {
        source: "/api/chat",
        destination: `${backendUrl}/api/chat`,
      },
    ];
  },
};

export default nextConfig;
