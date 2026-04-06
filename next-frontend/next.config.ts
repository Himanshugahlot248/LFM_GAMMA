import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/login", destination: "/home", permanent: false }];
  },
};

export default nextConfig;
