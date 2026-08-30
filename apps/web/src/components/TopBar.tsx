import Link from 'next/link'

export function TopBar({ email }: { email: string | null }) {
  return (
    <header className="topbar">
      <Link className="brand" href="/domains" style={{ textDecoration: 'none' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <rect x="1" y="1" width="22" height="22" rx="6" stroke="var(--border-strong)" />
          <path d="M8 7h3.2a5 5 0 0 1 0 10H8Z" stroke="var(--fg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Deed
      </Link>
      <span className="spacer" />
      {email !== null && <span className="t-small subtle nowrap">{email}</span>}
      <form action="/auth/signout" method="post">
        <button className="btn btn-ghost btn-sm" type="submit">
          Sign out
        </button>
      </form>
    </header>
  )
}
