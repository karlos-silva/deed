/**
 * The mark's glyph — a flag planted on a horizon — drawn on an 1800-unit canvas.
 *
 * The canvas is 1800 square and the glyph occupies only the middle 900 of it,
 * so scaling the whole box renders the mark at half the size you asked for.
 * The viewBox is cropped to the glyph's own bounds instead.
 */
const GLYPH =
  'M795 452a50 50 0 1 1 0 100a50 50 0 1 1 0-100ZM764 520H826V1262H764ZM826 548H1304L1196 712L1304 876H826ZM469 1350A780 780 0 0 1 1331 1350Z'

export function Mark({ size = 56, tile = true }: { size?: number; tile?: boolean }) {
  // Absolute, not a percentage: the tile centres its child, so the child is
  // shrink-to-fit and a percentage has nothing to resolve against — it collapses
  // to zero and the mark silently disappears.
  const ink = tile ? Math.round(size * 0.5) : size
  const glyph = (
    <svg viewBox="450 450 900 900" fill="none" aria-hidden="true" width={ink} height={ink}>
      <path d={GLYPH} fill="currentColor" />
    </svg>
  )

  if (!tile) return <span className="mark-glyph">{glyph}</span>

  return (
    <span className="mark-tile" style={{ width: size, height: size, borderRadius: size * 0.27 }}>
      {glyph}
    </span>
  )
}
