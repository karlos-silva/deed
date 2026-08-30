import { createBrowserClient, createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './generated'

export type Db = SupabaseClient<Database>

// The publishable key is browser-safe and RLS is what protects the data; the
// secret key must never reach a client chunk (a post-build scan enforces it, S0).

export const supabaseUrl = (): string => required('NEXT_PUBLIC_SUPABASE_URL')
export const publishableKey = (): string => required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')

export const browserDb = (): Db => createBrowserClient<Database>(supabaseUrl(), publishableKey())

export type CookieBridge = {
  getAll(): { name: string; value: string }[]
  setAll(written: { name: string; value: string; options?: unknown }[]): void
}

export const serverDb = (cookies: CookieBridge): Db =>
  createServerClient<Database>(supabaseUrl(), publishableKey(), {
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (written) => {
        cookies.setAll(written)
      },
    },
  })

/** The sweep, and nothing else: it runs with no session, so it bypasses RLS. */
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
