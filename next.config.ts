import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL ships a native binary for local files, so it stays outside the bundle.
  serverExternalPackages: ["@libsql/client", "libsql"],
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
