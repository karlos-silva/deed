import Image from 'next/image'
import { redirect } from 'next/navigation'
import { requestDb } from '@/lib/db'
import { origin } from '@/lib/origin'
import { session } from '@/lib/session'
import { GitHubMark } from '@/components/ProviderIcon'

export const dynamic = 'force-dynamic'

// prd §6.0 / D1, D22: one screen, no marketing, no landing page, one way in.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  if ((await session()) !== null) redirect('/domains')
  const { error } = await searchParams

  async function signIn() {
    'use server'
    const db = await requestDb()
    const { data, error: failure } = await db.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${await origin()}/auth/callback` },
    })
    if (failure !== null) {
      redirect(`/?error=${encodeURIComponent(failure.message)}`)
    }
    // The provider's authorisation URL is external, so it is not a typed route.
    redirect(data.url as Parameters<typeof redirect>[0])
  }

  return (
    <div className="signin-stage">
      <div className="signin-panel enter">
        <div className="tile-mark">
          <Image src="/mark.png" alt="" width={740} height={740} priority />
        </div>

        <div className="stack-2">
          <h1 className="signin-title">
            Log in to <span className="whole">Deed</span>
          </h1>
          <p className="signin-lede">Prove you own a domain, and see exactly why when you cannot.</p>
        </div>

        <form className="signin-actions" action={signIn}>
          <button className="btn" type="submit">
            <GitHubMark />
            Log in with GitHub
          </button>
        </form>

        {error !== undefined && (
          <div className="callout callout-danger" role="alert">
            {error}
          </div>
        )}

      </div>
    </div>
  )
}
