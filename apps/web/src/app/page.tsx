import Image from 'next/image'
import { redirect } from 'next/navigation'
import { requestDb } from '@/lib/db'
import { origin } from '@/lib/origin'
import { session } from '@/lib/session'
import { Footer } from '@/components/Footer'

export const dynamic = 'force-dynamic'

/**
 * One screen, no marketing: the tile, the product name, and two buttons
 * (prd §6.0, D1). Explaining the product to logged-out visitors is the README's
 * job — a visitor must grant OAuth to see anything, and that cost is
 * accepted rather than worked around.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  if ((await session()) !== null) redirect('/domains')
  const { error } = await searchParams

  async function signIn(formData: FormData) {
    'use server'
    const provider = formData.get('provider')
    if (provider !== 'github' && provider !== 'google') return

    const db = await requestDb()
    const { data, error: failure } = await db.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${await origin()}/auth/callback` },
    })
    if (failure !== null || data.url === null) {
      redirect(`/?error=${encodeURIComponent(failure?.message ?? 'sign-in unavailable')}`)
    }
    // The provider's authorisation URL is external, so it is not one of the
    // app's typed routes.
    redirect(data.url as Parameters<typeof redirect>[0])
  }

  return (
    <div className="signin">
      <div className="signin-card enter">
        <Image
          src="/domains-tile.png"
          alt=""
          width={740}
          height={740}
          priority
          style={{ width: 140, height: 'auto' }}
        />

        <div className="stack-2">
          <h1>Deed</h1>
          <p className="t-body muted">Prove you own a domain.</p>
        </div>

        <form className="buttons" action={signIn}>
          <button className="btn btn-primary" name="provider" value="github" type="submit">
            Continue with GitHub
          </button>
          <button className="btn btn-secondary" name="provider" value="google" type="submit">
            Continue with Google
          </button>
        </form>

        {error !== undefined && (
          <div className="callout callout-danger" role="alert">
            {error}
          </div>
        )}

        <Footer />
      </div>
    </div>
  )
}
