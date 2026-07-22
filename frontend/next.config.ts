import type { NextConfig } from "next";
import path from "path";

const sharedRoot = path.resolve(__dirname, "../shared");

const nextConfig: NextConfig = {
  // Smaller production image when built via frontend/Dockerfile (standalone server.js).
  output: "standalone",
  // Allow importing ../shared from the monorepo root
  experimental: {
    externalDir: true,
  },
  transpilePackages: ["react-force-graph-2d", "force-graph"],
  // Turbopack (next dev --turbopack) ignores webpack aliases
  turbopack: {
    resolveAlias: {
      "@shared": sharedRoot,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@shared": sharedRoot,
    };
    return config;
  },
};

export default nextConfig;
