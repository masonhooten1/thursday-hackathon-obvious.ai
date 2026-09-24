import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Route handlers and server-only libs (pg, node:crypto) must never reach the
  // browser bundle; "server-only" imports guard this at module level.
};

export default nextConfig;
