/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // The MCP server packages ship ESM/CJS dual builds with runtime provider selection;
    // keep them external so Node loads them directly instead of webpack bundling them.
    serverComponentsExternalPackages: ['mcp-handler', '@modelcontextprotocol/server', '@modelcontextprotocol/core'],
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'dd.dexscreener.com' },
      { protocol: 'https', hostname: 'dexscreener.com' },
      { protocol: 'https', hostname: 'raw.githubusercontent.com' },
      { protocol: 'https', hostname: 'assets.coingecko.com' },
      { protocol: 'https', hostname: 'coin-images.coingecko.com' },
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: 'arweave.net' },
      { protocol: 'https', hostname: 'pump.mypinata.cloud' },
    ],
  },
}

module.exports = nextConfig
