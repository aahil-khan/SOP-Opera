import type { NextConfig } from "next";
import path from "path";

const sharedRoot = path.resolve(__dirname, "../shared");

const nextConfig: NextConfig = {
  // Allow importing ../shared from the monorepo root
  experimental: {
    externalDir: true,
  },
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
