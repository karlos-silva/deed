import Image from 'next/image'
import Link from 'next/link'

/**
 * The account end of the bar is two icons now, not an address and a word. The
 * email was a 24-character string doing the work of "you are signed in", read
 * once and then ignored on every page after — and it is the one piece of
 * personal data on screen at all times, including over a shoulder.
 *
 * Neither loses its name: the avatar carries the whole address for a screen
 * reader and in its tooltip, and the button says "Sign out" the same way.
 */
export function TopBar({ email }: { email: string | null }) {
  return (
    <header className="topbar">
      <Link className="brand" href="/domains">
        <span className="brand-mark">
          <Image src="/domains-tile.png" alt="" width={740} height={740} />
        </span>
        Deed
      </Link>
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
