import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Starts a real Postgres in Docker, applies the migrations, and tears it
    // down afterwards. See test/setup-postgres.ts for why not `supabase start`.
    globalSetup: ['./test/setup-postgres.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One database, shared state: these run in sequence on purpose.
    fileParallelism: false,
  },
})
