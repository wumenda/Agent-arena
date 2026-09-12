import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 为原生模块，不能被打包
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
