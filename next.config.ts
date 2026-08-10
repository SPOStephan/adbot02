import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep sharp as a native Node package; bundling it can break image uploads.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
