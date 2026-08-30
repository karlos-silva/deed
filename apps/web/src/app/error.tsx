'use client'

import Link from 'next/link'

/**
 * An error boundary that offers a way back, rather than a blank page (S8).
 * A product about explaining failure has no business failing silently.
 */
export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="signin">
      <div className="signin-card">
        <h1>Something broke on this page</h1>
        <p className="t-body muted">
          This is our failure, not your DNS. Nothing about your domains has changed — no check ran,
          no state moved.
        </p>
        <div className="buttons">
          <button className="btn btn-primary" type="button" onClick={reset}>
            Try again
          </button>
          <Link className="btn btn-secondary" href="/domains">
            Back to domains
          </Link>
        </div>
      </div>
    </div>
  )
}
