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
  // Browsers use the <link rel="icon"> tags Next emits from app/icon.png, but
  // crawlers and older clients still ask for the legacy path.
  redirects: () =>
    Promise.resolve([{ source: '/favicon.ico', destination: '/icon.png', permanent: true }]),
}

export default config
