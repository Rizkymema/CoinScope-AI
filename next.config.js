/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
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
