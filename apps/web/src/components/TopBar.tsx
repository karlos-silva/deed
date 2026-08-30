import Link from 'next/link'
import { Mark } from '@/components/Mark'

export function TopBar({ email }: { email: string | null }) {
  return (
    <header className="topbar">
      <Link className="brand" href="/domains" style={{ textDecoration: 'none' }}>
        <Mark size={22} />
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
