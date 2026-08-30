import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Refreshes the auth cookies on every navigation. Server Components cannot write
 * cookies, so without this a session would silently expire mid-visit and the
 * user would be signed out by a page load.
 *
 * Nothing in here may take the site down. Middleware runs before every route, so
 * anything it throws becomes an opaque platform-level 500 on *every* URL, with
 * no page rendered and no way for the app to explain itself — including
 * `/api/health`, the one endpoint whose whole job is saying what is wrong. A
 * session that failed to refresh is a request that carries on unauthenticated,
 * which every route already handles.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  try {
    return await refreshSession(request)
  } catch (error) {
    console.error('[middleware] session refresh failed, continuing unauthenticated:', error)
    return NextResponse.next({ request })
  }
}

async function refreshSession(request: NextRequest): Promise<NextResponse> {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']?.trim()
  const key = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']?.trim()

  if (isBlank(url) || isBlank(key)) {
    console.error(
      '[config] missing %s — sign-in will not persist. /api/health lists what is set.',
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

  await db.auth.getUser()
  return response
}

const isBlank = (value: string | undefined): value is undefined => value === undefined || value === ''

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp)$).*)'],
}
