import { CHALLENGE_LABEL } from '@deed/core'

/**
 * A first-time account needs somewhere to start, and an empty table under a
 * heading is not it (S3). This says what claiming does, what it will need, and
 * — because the product reads other people's DNS — what it will not do.
 */
export function NothingClaimedYet() {
  return (
    <section className="empty" style={{ marginTop: 'var(--space-6)' }}>
      <div className="stack">
        <h2 className="t-section">Nothing claimed yet</h2>
        <p className="t-body muted" style={{ maxWidth: '52ch', margin: '0 auto' }}>
          Claiming generates one high-entropy token scoped to you and this domain. You publish it as
          a single TXT record at <span className="t-mono">{CHALLENGE_LABEL}.&lt;your-domain&gt;</span>,
          and we read it back. You will need access to the domain’s DNS — or, if you would rather
          not use a real one, a <span className="t-mono">.test</span> name and nothing else.
        </p>
        <p className="t-small subtle">We only ever make read queries against your DNS.</p>
      </div>
    </section>
  )
}
