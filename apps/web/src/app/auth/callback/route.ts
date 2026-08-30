import { NextResponse } from 'next/server'
import { requestDb } from '@/lib/db'

/**
 * The OAuth landing. Exchanging the code here — rather than in a client
 * component — keeps the session in httpOnly cookies, which is the whole reason
 * to use the SSR client (D1).
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/domains'

  if (code === null) {
    const reason = url.searchParams.get('error_description') ?? 'no authorisation code'
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(reason)}`, url.origin))
  }

  const db = await requestDb()
  const { error } = await db.auth.exchangeCodeForSession(code)
  if (error !== null) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error.message)}`, url.origin))
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
