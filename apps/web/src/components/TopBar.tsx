import Image from 'next/image'
import Link from 'next/link'
import type { Route } from 'next'

/**
 * The account end of the bar is two icons now, not an address and a word. The
 * email was a 24-character string doing the work of "you are signed in", read
 * once and then ignored on every page after — and it is the one piece of
 * personal data on screen at all times, including over a shoulder.
 *
 * Neither loses its name: the avatar carries the whole address for a screen
 * reader and in its tooltip, and the button says "Sign out" the same way.
 */
export type Crumb = { label: string; href?: Route; mono?: boolean }

/**
 * Where you are, as a trail after the mark rather than as a button in the page:
 * "All domains" was a control that only ever meant "up one level", and the
 * trail says that while also saying which domain this is.
 */
export function TopBar({ email, trail = [] }: { email: string | null; trail?: Crumb[] }) {
  return (
    <header className="topbar">
      <Link className="brand" href="/domains">
        <span className="brand-mark">
          <Image src="/mark.png" alt="" width={740} height={740} />
        </span>
        Deed
      </Link>

      {trail.length > 0 && (
        <nav className="trail" aria-label="Breadcrumb">
          <ol>
            {trail.map((crumb, index) => {
              const last = index === trail.length - 1
              const className = crumb.mono === true ? 't-mono' : undefined
              return (
                <li key={`${crumb.label}-${String(index)}`}>
                  {crumb.href !== undefined && !last ? (
                    <Link href={crumb.href} className={className}>
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={className} {...(last && { 'aria-current': 'page' as const })}>
                      {crumb.label}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      )}

      <span className="spacer" />

      {email !== null && (
        <span className="avatar" title={email}>
          <span className="visually-hidden">Signed in as {email}</span>
          <span aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span>
        </span>
      )}

      <form action="/auth/signout" method="post">
        <button
          className="btn btn-secondary btn-sm btn-icon"
          type="submit"
          title="Sign out"
          aria-label="Sign out"
        >
          <SignOutIcon />
        </button>
      </form>
    </header>
  )
}

function SignOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M10.5 5 13.5 8l-3 3M13 8H6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
