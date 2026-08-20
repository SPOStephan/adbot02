import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep sharp as a native Node package; bundling it can break image uploads.
  serverExternalPackages: ["sharp"],
  // Browsers still hard-request /favicon.ico; serve the dynamic branding icon.
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon" }];
  },
};

export default nextConfig;
