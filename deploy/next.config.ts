import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, ".."),
  reactCompiler: true,
  transpilePackages: ["@matrx/admin-ui"],
};

export default nextConfig;
