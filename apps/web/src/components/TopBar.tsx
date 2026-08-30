import Image from 'next/image'
import Link from 'next/link'

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
      {email !== null && <span className="t-small subtle nowrap">{email}</span>}
      <form action="/auth/signout" method="post">
        <button className="btn btn-ghost btn-sm" type="submit">
          Sign out
        </button>
      </form>
    </header>
  )
}
