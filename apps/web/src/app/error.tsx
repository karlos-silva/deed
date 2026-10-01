'use client'

import Link from 'next/link'

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="shell">
      <main className="notice-page">
        <div className="notice enter">
          <p className="eyebrow">Our failure</p>
          <h1 className="display">Something broke on this page</h1>
          <p>
            This is our failure, not your DNS. Nothing about your domains has changed — no check
            ran, no state moved.
          </p>
          <div className="actions">
            <button className="btn btn-primary" type="button" onClick={reset}>
              Try again
            </button>
            <Link className="btn btn-secondary" href="/domains">
              Back to domains
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
