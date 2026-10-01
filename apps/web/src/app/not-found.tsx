import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="shell">
      <main className="notice-page">
        <div className="notice enter">
          <p className="eyebrow">Not on record</p>
          <h1 className="display">Nothing here</h1>
          <p>
            This page does not exist, or it belongs to another account. Either way there is nothing
            to show you.
          </p>
          <div className="actions">
            <Link className="btn btn-secondary" href="/domains">
              Back to domains
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
