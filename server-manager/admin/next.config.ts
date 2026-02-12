import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, "../.."),
  basePath: "/admin",
  reactCompiler: true,
  images: { unoptimized: true },
  transpilePackages: ["@matrx/admin-ui"],
};

export default nextConfig;
