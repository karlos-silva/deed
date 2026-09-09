import type { PreflightStep } from '@/lib/preflightSteps'

/**
 * The zone analysis as the four checks it is, rather than as whatever warnings
 * happened to fire. `.steps` has been in the design system since S1 with no
 * caller; this is the screen it was drawn for.
 *
 * While the lookups are out every step is `todo` — the three run in one
 * `Promise.all` and land together, so ticking them off one by one would be an
 * animation of something that did not happen.
 */
export function PreflightSteps({ steps, busy }: { steps: PreflightStep[]; busy: boolean }) {
  return (
    <ol className={busy ? 'steps' : 'steps enter'} aria-busy={busy || undefined}>
      {steps.map((step) => (
        <li className="step" key={step.id} data-state={step.state}>
          <span className="step-marker" aria-hidden="true">
            {step.state === 'done' ? <CheckIcon /> : step.state === 'failed' ? '!' : ''}
          </span>
          <div>
            <p className="step-title">{step.title}</p>
            {step.detail !== null && <p className="step-desc">{step.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8.5 6.3 12 13 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
