import type { NextConfig } from "next";

const backendUrl =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:4000";

const nextConfig: NextConfig = {
  // Output standalone build for lightweight container and Azure App Service deployments
  output: process.env.NEXT_OUTPUT_STANDALONE === "false" ? undefined : "standalone",

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
