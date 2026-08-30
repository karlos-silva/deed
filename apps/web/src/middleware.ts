import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Refreshes the auth cookies on every navigation. Server Components cannot write
 * cookies, so without this a session would silently expire mid-visit and the
 * user would be signed out by a page load.
 */
export async function middleware(request: NextRequest) {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const key = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']

  // Missing configuration is an operator error, and it must not present as a
  // dead site. Crashing here fails every route at the edge with
  // MIDDLEWARE_INVOCATION_FAILED and no clue attached; letting the request
  // through means the page renders the app's own error boundary, and `/api/health`
  // still answers with exactly which variable is absent.
  if (isBlank(url) || isBlank(key)) {
    console.error(
      '[config] missing %s — the session cannot be refreshed, so sign-in will not persist.',
      [isBlank(url) && 'NEXT_PUBLIC_SUPABASE_URL', isBlank(key) && 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
        .filter(Boolean)
        .join(' and '),
    )
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const db = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (written) => {
        for (const { name, value } of written) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of written) response.cookies.set(name, value, options)
      },
    },
  })

  try {
    await db.auth.getUser()
  } catch (error) {
    // A refresh failing is not a reason to refuse the page. The request carries
    // on unauthenticated, which is a state every route already handles.
    console.error('[auth] session refresh failed:', error)
  }

  return response
}

const isBlank = (value: string | undefined): value is undefined => value === undefined || value === ''

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp)$).*)'],
}
