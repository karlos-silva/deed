import type { Verdict } from '@/lib/verdict'

/**
 * The one thing the page says about where this claim stands. Exactly one of
 * these renders, in every state, so two sentences can no longer disagree.
 *
 * When it carries `did-verify`, `bloom` in motion.css finally has a caller: prd
 * §6.5 asks for one celebratory moment in the flow, and the animation has been
 * shipping to browsers since S3 with nothing to trigger it. It fires on the
 * transition rather than on a wall-clock window, because `AutoRefresh` re-renders
 * every 20–45s and a window would replay it — "once per lifecycle" would become
 * a loop. Reduced motion is already covered by the global block in motion.css.
 */
export function VerdictBanner({ verdict }: { verdict: Verdict }) {
  return (
    <section
      className={`callout callout-${verdict.tone} verdict${verdict.celebrate ? ' did-verify' : ''}`}
      role={verdict.tone === 'danger' ? 'alert' : 'status'}
    >
      <div className="guidance">
        {/* prd §7: a diagnosis has to answer whether waiting helps — first, as
            the line's kicker, because it decides how the rest is read. When
            there is nothing to wait for it says nothing, rather than saying so. */}
        {verdict.waitingHelps !== null && (
          <p className="verdict-line" data-helps={verdict.waitingHelps}>
            {verdict.waitingHelps ? 'waiting helps' : 'waiting will not fix this'}
          </p>
        )}
        <strong className="headline">{verdict.headline}</strong>
        <p className="body">{verdict.body}</p>
        {verdict.fix !== undefined && <p className="fix">{verdict.fix}</p>}
      </div>
    </section>
  )
}
