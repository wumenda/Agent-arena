import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 为原生模块、puppeteer-core 需运行时 require，均不能被打包
  serverExternalPackages: ["better-sqlite3", "puppeteer-core"],
};

export default nextConfig;
