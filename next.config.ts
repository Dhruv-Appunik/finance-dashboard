import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app reads a local SQLite file on every request, so nothing is prerendered or cached.
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
