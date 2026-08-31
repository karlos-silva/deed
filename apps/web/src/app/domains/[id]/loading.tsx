import { Footer } from '@/components/Footer'
import { TopBar } from '@/components/TopBar'

/**
 * The detail page's own shape, because it is the slow one: it can await a live
 * check and then a nine-lookup preflight before it paints. A placeholder in the
 * geometry of what is coming reads as loading; one in a different geometry reads
 * as the page having changed.
 */
export default function Loading() {
  return (
    <div className="shell">
      <TopBar email={null} />

      <main className="main stack-6">
        <div className="page-head">
          <div className="stack-2">
            <div className="skeleton" style={{ height: 30, width: 260, borderRadius: 8 }} />
            <div className="skeleton" style={{ height: 16, width: 340, borderRadius: 6 }} />
          </div>
          <div className="skeleton" style={{ height: 32, width: 110, borderRadius: 8 }} />
        </div>

        <div className="skeleton" style={{ height: 190, borderRadius: 'var(--radius-lg)' }} />
        <div className="skeleton" style={{ height: 240, borderRadius: 'var(--radius-lg)' }} />
      </main>

      <Footer />
    </div>
  )
}
