/**
 * The mark's glyph — a flag planted on a horizon — set in a milled tile (D18).
 */
export function Mark({ size = 56, tile = true }: { size?: number; tile?: boolean }) {
  const glyph = (
    <svg viewBox="0 0 1800 1800" fill="none" aria-hidden="true" width={tile ? '58%' : size} height={tile ? '58%' : size}>
      <path
        d="M795 452a50 50 0 1 1 0 100a50 50 0 1 1 0-100ZM764 520H826V1262H764ZM826 548H1304L1196 712L1304 876H826ZM469 1350A780 780 0 0 1 1331 1350Z"
        fill="currentColor"
      />
    </svg>
  )

  if (!tile) return <span className="mark-glyph">{glyph}</span>

  return (
    <span className="mark-tile" style={{ width: size, height: size, borderRadius: size * 0.28 }}>
      {glyph}
    </span>
  )
}
