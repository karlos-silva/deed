/**
 * S3 asks that a first-time account not be handed an empty table under a
 * heading. One line, not a lecture: what a claim is, and the way in that needs
 * nothing you do not already have.
 */
export function NothingClaimedYet() {
  return (
    <section className="empty-state">
      <h2 className="t-section">No domains yet</h2>
      <p>
        Claiming issues one token to publish as a TXT record. A{' '}
        <span className="t-mono">.test</span> name works without owning anything.
      </p>
    </section>
  )
}
