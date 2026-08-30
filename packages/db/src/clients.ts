import { createBrowserClient, createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './generated'

export type Db = SupabaseClient<Database>

/**
 * Three clients, three trust levels. The publishable key is safe in the browser
 * bundle and RLS is what protects the data; the secret key never leaves the
 * server, and a post-build scan fails the build if it ever appears in a client
 * chunk (delivery plan, S0).
 */

export const supabaseUrl = (): string => required('NEXT_PUBLIC_SUPABASE_URL')
export const publishableKey = (): string => required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')

export const browserDb = (): Db => createBrowserClient<Database>(supabaseUrl(), publishableKey())

/**
 * The cookie bridge the caller supplies. Framework-shaped adapters live in the
 * app; this package stays a Supabase concern.
 */
export type CookieBridge = {
  getAll(): { name: string; value: string }[]
  setAll(written: { name: string; value: string; options?: unknown }[]): void
}

/** For Server Components and Route Handlers: the user's session, under RLS. */
export const serverDb = (cookies: CookieBridge): Db =>
  createServerClient<Database>(supabaseUrl(), publishableKey(), {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (written) => {
        cookies.setAll(written)
      },
    },
  })

/**
 * The sweep, and nothing else. It runs with no session, so RLS cannot express
 * "this domain is due" — the secret key is how a background job reads every
 * account's claims without impersonating anybody.
 */
export const serviceDb = (): Db =>
  createClient<Database>(supabaseUrl(), required('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set. See apps/web/.env.example.`)
  }
  return value
}
