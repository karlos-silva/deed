import Image from 'next/image'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { type OwnershipState, at, token } from '@deed/core'
import { requestDb } from '@/lib/db'
import { origin } from '@/lib/origin'
import { session } from '@/lib/session'
import { GitHubMark } from '@/components/ProviderIcon'
import { Footer } from '@/components/Footer'
import { Seal } from '@/components/Seal'

export const dynamic = 'force-dynamic'

// The front door is the one page meant to be found (D23); everything behind
// sign-in stays out of search.
export const metadata: Metadata = { robots: { index: true, follow: true } }

const SOURCE = 'https://github.com/karlos-silva/deed'

/**
 * A small landing page in front of sign-in (D23, amending D1): what Deed does,
 * shown on an example claim rather than described, and one way in.
 */
export default async function FrontDoor({
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
    <div className="shell landing">
      <header className="topbar">
        <a className="brand" href="#top">
          <span className="brand-mark">
            <Image src="/mark.png" alt="" width={740} height={740} priority />
          </span>
          Deed
        </a>
        <span className="spacer" />
        <a className="btn btn-ghost btn-sm" href={SOURCE}>
          <GitHubMark />
          Source
        </a>
        <form action={signIn}>
          <button className="btn btn-secondary btn-sm" type="submit">
            Log in
          </button>
        </form>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy enter">
            <p className="eyebrow">Domain ownership, made legible</p>
            <h1 className="display">
              Prove you own a domain.
              <span className="display-after">And see exactly why when you can’t.</span>
            </h1>
            <p className="lede">
              Deed issues one TXT record, then reads it back from three independent resolvers. When
              the answer is wrong, it names the provider quirk that broke it — and tells you whether
              waiting will help.
            </p>

            <div className="hero-actions">
              <form action={signIn}>
                <button className="btn btn-primary btn-lg" type="submit">
                  <GitHubMark />
                  Log in with GitHub
                </button>
              </form>
              <a className="btn btn-ghost btn-lg" href="#how">
                How it works <span aria-hidden="true">↓</span>
              </a>
            </div>

            {error !== undefined && (
              <div className="callout callout-danger" role="alert">
                {error}
              </div>
            )}

            <p className="fineprint">
              Read-only: Deed never writes to your DNS. No domain to hand? Any{' '}
              <span className="t-mono">.test</span> name runs against a zone you edit yourself.
            </p>
          </div>

          <Specimen />
        </section>

        <section className="lp-section" id="how">
          <div className="lp-head">
            <p className="eyebrow">How it works</p>
            <h2 className="lp-title">Three steps, and nothing goes quiet.</h2>
          </div>
          <ol className="steps-lp">
            <li>
              <span className="step-no">01</span>
              <h3>Claim</h3>
              <p>
                Type a domain. Before a token exists, Deed reads the zone: whose panel you are about
                to open, whether a wildcard answers, whether the host is already a CNAME.
              </p>
            </li>
            <li>
              <span className="step-no">02</span>
              <h3>Publish</h3>
              <p>
                One TXT record, copied cell by cell, under the field names your provider’s own panel
                uses — so what you paste is what it asks for.
              </p>
            </li>
            <li>
              <span className="step-no">03</span>
              <h3>Watch</h3>
              <p>
                Three resolvers answer. You see who has it, who is still caching the old answer and
                for how long — and Deed keeps checking after it verifies.
              </p>
            </li>
          </ol>
        </section>

        <section className="lp-section">
          <div className="lp-head">
            <p className="eyebrow">When it breaks</p>
            <h2 className="lp-title">
              Not <em>pending</em>. A cause.
            </h2>
            <p className="lede">
              Every diagnosis answers two questions: does waiting help, and what exactly do you do.
              Here are three of the thirteen.
            </p>
          </div>
          <div className="diagnoses">
            <Diagnosis
              tone="danger"
              helps={false}
              headline="Your provider wrapped the value in quotes"
              fix="Paste the value without quotes. The panel adds its own."
            />
            <Diagnosis
              tone="info"
              helps
              headline="Seen by 1 of 3 resolvers"
              body="Cloudflare · 1.1.1.1 already has it. The rest are still serving a cached answer, for up to 4 hours."
            />
            <Diagnosis
              tone="warning"
              helps={false}
              headline="The record is missing; a wildcard is answering in its place"
              fix="Create the TXT record. An explicit record overrides the wildcard."
            />
          </div>
        </section>

        <section className="lp-section lp-close">
          <div className="lp-head">
            <p className="eyebrow">Built as a study</p>
            <h2 className="lp-title">A small product, built carefully.</h2>
            <p className="lede">
              A pure, exhaustively tested state machine. Resolvers behind one port, with a simulated
              zone that drives the same engine. Invariants held by Postgres rather than by
              convention. And a decision log that keeps what was tried and cut.
            </p>
          </div>
          <div className="hero-actions">
            <form action={signIn}>
              <button className="btn btn-primary btn-lg" type="submit">
                <GitHubMark />
                Log in with GitHub
              </button>
            </form>
            <a className="btn btn-secondary btn-lg" href={SOURCE}>
              Read the source
            </a>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}

const VERIFIED: OwnershipState = {
  status: 'verified',
  token: token('uyxawsmda4slfuoy5kqsxemuu2vfgzuzdmb6e2np2dzscadiqa3q'),
  verifiedAt: at(0),
}

/**
 * An example claim, drawn with the app's own pieces: the seal, the record as a
 * slip, and what each resolver answered. Proven at two of three, because that
 * is what quorum means — the third is still serving its cache.
 */
function Specimen() {
  return (
    <figure className="specimen">
      <div className="specimen-card">
        <div className="specimen-head">
          <div className="stack-2">
            <p className="eyebrow">Deed of claim</p>
            <p className="specimen-title">
              acme<span className="dot-sep">.</span>com
            </p>
          </div>
          <Seal ownership={VERIFIED} />
        </div>

        <div className="specimen-record">
          <span className="t-label">TXT</span>
          <span className="t-mono host">_deed-challenge</span>
          <span className="t-mono value">deed-challenge=uyxawsmda4…dzscadiqa3q</span>
        </div>

        <ul className="specimen-readings">
          <li data-state="ok">
            <span className="mdot" aria-hidden="true" />
            <span className="who">Cloudflare · 1.1.1.1</span>
            <span className="said">has your token</span>
            <span className="num">5 min</span>
          </li>
          <li data-state="ok">
            <span className="mdot" aria-hidden="true" />
            <span className="who">Google · 8.8.8.8</span>
            <span className="said">has your token</span>
            <span className="num">4 h</span>
          </li>
          <li>
            <span className="mdot" aria-hidden="true" />
            <span className="who">AdGuard · unfiltered</span>
            <span className="said">not yet</span>
            <span className="num">—</span>
          </li>
        </ul>
      </div>
      <figcaption>An example claim, proven at two of three resolvers.</figcaption>
    </figure>
  )
}

function Diagnosis({
  tone,
  helps,
  headline,
  body,
  fix,
}: {
  tone: 'danger' | 'info' | 'warning'
  helps: boolean
  headline: string
  body?: string
  fix?: string
}) {
  return (
    <article className={`callout callout-${tone} verdict verdict-sm`}>
      <div className="guidance">
        <p className="verdict-line" data-helps={helps}>
          {helps ? 'waiting helps' : 'waiting will not fix this'}
        </p>
        <strong className="headline">{headline}</strong>
        {body !== undefined && <p className="body">{body}</p>}
        {fix !== undefined && <p className="fix">{fix}</p>}
      </div>
    </article>
  )
}
