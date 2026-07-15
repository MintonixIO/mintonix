import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Legacy flat app paths → nested under /dashboard/*
  async redirects() {
    return [
      { source: "/library", destination: "/dashboard/library", permanent: true },
      { source: "/analysis", destination: "/dashboard/analysis", permanent: true },
      { source: "/highlights", destination: "/dashboard/highlights", permanent: true },
      { source: "/settings", destination: "/dashboard/settings", permanent: true },
      { source: "/help-support", destination: "/dashboard/help-support", permanent: true },
      { source: "/compare", destination: "/dashboard/compare", permanent: true },
    ];
  },
};

export default nextConfig;
