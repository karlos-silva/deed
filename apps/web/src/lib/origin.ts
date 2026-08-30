import { headers } from 'next/headers'

/**
 * The origin this request actually arrived on. OAuth redirect URIs have to match
 * exactly, and hardcoding one breaks either local development or the deploy —
 * usually whichever you test last (S0).
 */
export async function origin(): Promise<string> {
  const h = await headers()
  const explicit = process.env['NEXT_PUBLIC_SITE_URL']
  if (explicit !== undefined && explicit !== '') return explicit.replace(/\/$/, '')

  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:4321'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
