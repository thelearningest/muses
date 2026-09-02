import type { NextConfig } from "next";

const isVercelTarget =
  process.env.VERCEL === "1" || process.env.NEXT_HOST_TARGET === "vercel";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: isVercelTarget ? "tsconfig.vercel.json" : "tsconfig.json",
  },
  experimental: {
    // Keep the transport limit just above the 50 MiB product limit so the
    // multipart boundary and headers do not reject an otherwise valid PDF.
    serverActions: {
      bodySizeLimit: "51mb",
    },
  },
};

export default nextConfig;
