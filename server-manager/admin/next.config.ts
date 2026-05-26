import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, "../.."),
  basePath: "/admin",
  reactCompiler: true,
  images: { unoptimized: true },
  transpilePackages: ["@matrx/admin-ui"],
  // Traefik routes the bare domain root (everything that isn't /api,/mcp,/health)
  // here, but this app lives under basePath /admin — so `/` has no route and 404s.
  // Send it to the dashboard. `basePath: false` matches the true root, not /admin/.
  async redirects() {
    return [
      { source: "/", destination: "/admin/instances", permanent: false, basePath: false },
      // aidream's OAuth broker sends denied users to the bare-origin /access-denied
      // (no /admin prefix). Map it under basePath where the page actually lives.
      { source: "/access-denied", destination: "/admin/access-denied", permanent: false, basePath: false },
      // Console (a weak single-command box) was retired in favor of the real
      // interactive Terminal. Send any old links/bookmarks there.
      { source: "/console", destination: "/terminal", permanent: false },
    ];
  },
};

export default nextConfig;
