import type { NextConfig } from "next";

const config: NextConfig = {
  // Licence photos can be large; the upload route checks the 10 MB limit itself.
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  poweredByHeader: false,
};
export default config;
