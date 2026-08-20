/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdf-parse ships a debug harness that touches the filesystem at import time;
  // keep it external so the serverless bundler does not try to trace it.
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"],
  },
};

module.exports = nextConfig;
