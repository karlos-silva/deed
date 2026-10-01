import type { OwnershipState } from '@deed/core'
import { claimLabel, claimTone } from '@/components/StatusBadge'

/** The mark's flag on its horizon, on the 1800-unit canvas the tile was drawn on. */
const FLAG =
  'M795 452a50 50 0 1 1 0 100a50 50 0 1 1 0-100ZM764 520H826V1262H764ZM826 548H1304L1196 712L1304 876H826ZM469 1350A780 780 0 0 1 1331 1350Z'

const RING = 78
const CIRCUMFERENCE = 2 * Math.PI * RING

/**
 * The claim's standing as a registrar's seal, stamped on the deed. It repeats
 * the status badge on purpose and says nothing the page does not: it is the
 * page's signature, so it is hidden from assistive tech, which already has the
 * badge.
 *
 * Pending is the one state that is still moving, so its legend turns; a closed
 * claim's seal is greyed and broken, the way a void stamp is.
 */
export function Seal({ ownership }: { ownership: OwnershipState }) {
  const tone = claimTone(ownership)
  const label = claimLabel(ownership).toUpperCase()
  const id = `seal-${tone}`
  const legend = `${label} · DEED OF CLAIM · ${label} · DEED OF CLAIM · `

  return (
    <div className="seal" data-state={tone} aria-hidden="true">
      <svg viewBox="0 0 200 200" width="200" height="200">
        <defs>
          <path
            id={`${id}-ring`}
            d={`M100,100 m-${RING},0 a${RING},${RING} 0 1,1 ${RING * 2},0 a${RING},${RING} 0 1,1 -${RING * 2},0`}
          />
          {/* Ink, not vector: the edges wander a little and the fill drops out in
              specks, the way a rubber stamp never quite lands everywhere. */}
          <filter id={`${id}-ink`} x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="7" result="wobble" />
            <feDisplacementMap in="SourceGraphic" in2="wobble" scale="1.8" xChannelSelector="R" yChannelSelector="G" result="rough" />
            <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="3" result="speck" />
            <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -6 0 0 0 4.9" result="mask" />
            <feComposite in="rough" in2="mask" operator="in" />
          </filter>
          <radialGradient id={`${id}-wash`}>
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx="100" cy="100" r="96" fill={`url(#${id}-wash)`} />

        <g filter={`url(#${id}-ink)`} fill="none" stroke="currentColor">
          <circle className="seal-outer" cx="100" cy="100" r="94" strokeWidth="2.4" />
          <circle cx="100" cy="100" r="89" strokeWidth="0.9" />
          <circle className="seal-inner" cx="100" cy="100" r="64" strokeWidth="1.4" />

          <g className="seal-legend">
            <text fill="currentColor" stroke="none" fontSize="11.5" letterSpacing="1.5">
              <textPath href={`#${id}-ring`} textLength={CIRCUMFERENCE - 2} lengthAdjust="spacing">
                {legend}
              </textPath>
            </text>
          </g>

          <svg x="66" y="60" width="68" height="68" viewBox="450 450 900 900">
            <path d={FLAG} fill="currentColor" stroke="none" />
          </svg>
        </g>
      </svg>
    </div>
  )
}
