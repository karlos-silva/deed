import { headers } from 'next/headers'

// OAuth redirect URIs must match exactly, and a hardcoded one breaks either local development or the deploy (S0).
export async function origin(): Promise<string> {
  const h = await headers()
  const explicit = process.env['NEXT_PUBLIC_SITE_URL']
  if (explicit !== undefined && explicit !== '') return explicit.replace(/\/$/, '')

  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:4321'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
