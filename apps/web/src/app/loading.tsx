import { Footer } from '@/components/Footer'
import { TopBar } from '@/components/TopBar'

/**
 * `TopBar` is rendered per page rather than in the layout, so it sits inside
 * this Suspense boundary — which meant the previous version of this file, three
 * grey bars in a bare div, deleted the entire application on every navigation.
 * The header blinked out, bars landed at arbitrary heights, and the chrome
 * snapped back. What loads is the content, so only the content should move.
 */
export default function Loading() {
  return (
    <div className="shell">
      <TopBar email={null} />

      <main className="main">
        <div className="page-head">
          <div className="skeleton" style={{ height: 30, width: 170, borderRadius: 8 }} />
          <div className="skeleton" style={{ height: 32, width: 130, borderRadius: 8 }} />
        </div>

        <div className="skeleton" style={{ height: 220, borderRadius: 'var(--radius-lg)' }} />
      </main>

      <Footer />
    </div>
  )
}
