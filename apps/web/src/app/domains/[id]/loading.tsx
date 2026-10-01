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
      <TopBar email={null} trail={[{ label: 'Domains', href: '/domains' }]} />

      <main className="main deed">
        <header className="deed-head">
          <div className="deed-id">
            <p className="eyebrow">Deed of claim</p>
            <div className="skeleton" style={{ height: 64, width: 'min(520px, 80%)', borderRadius: 12 }} />
          </div>
          <div className="skeleton" style={{ width: 148, height: 148, borderRadius: '50%' }} />
        </header>

        <div className="skeleton" style={{ height: 70, borderRadius: 12 }} />
        <div className="skeleton" style={{ height: 180, borderRadius: 18 }} />
        <div className="skeleton" style={{ height: 220, borderRadius: 18 }} />
      </main>

      <Footer />
    </div>
  )
}
