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
      <TopBar email={null} trail={[{ label: 'Domains' }]} />

      <main className="main register-page">
        <header className="register-head">
          <div className="stack-3">
            <p className="eyebrow">The register</p>
            <h1 className="display">Domains</h1>
            <div className="skeleton" style={{ height: 14, width: 220, marginTop: 8 }} />
          </div>
          <div className="skeleton" style={{ height: 36, width: 132, borderRadius: 10 }} />
        </header>

        <div className="stack-3">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="skeleton" style={{ height: 54, borderRadius: 10 }} />
          ))}
        </div>
      </main>

      <Footer />
    </div>
  )
}
