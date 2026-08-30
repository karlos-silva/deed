import type { NextConfig } from 'next'

const config: NextConfig = {
  // The workspace packages ship TypeScript source, not a build step (D7).
  transpilePackages: [
    '@deed/core',
    '@deed/db',
    '@deed/dns',
    '@deed/ui',
  ],
  typedRoutes: true,
}

export default config
