import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Refreshes the auth cookies on every navigation. Server Components cannot
 * write cookies, so without this a session would silently expire mid-visit and
 * the user would be signed out by a page load.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const db = createServerClient(
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? '',
    process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] ?? '',
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (written) => {
          for (const { name, value } of written) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of written) response.cookies.set(name, value, options)
        },
      },
    },
  )

  await db.auth.getUser()
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp)$).*)'],
}
