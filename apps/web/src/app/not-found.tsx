import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="signin">
      <div className="signin-card">
        <h1>Nothing here</h1>
        <p className="t-body muted">
          This page does not exist, or it belongs to another account. Either way there is nothing to
          show you.
        </p>
        <Link className="btn btn-secondary" href="/domains">
          Back to domains
        </Link>
      </div>
    </div>
  )
}
