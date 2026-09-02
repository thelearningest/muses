import type { NextConfig } from "next";

const isVercelTarget =
  process.env.VERCEL === "1" || process.env.NEXT_HOST_TARGET === "vercel";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: isVercelTarget ? "tsconfig.vercel.json" : "tsconfig.json",
  },
};

export default nextConfig;
