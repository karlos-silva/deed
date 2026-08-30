/** TXT values over 255 bytes arrive as several character-strings that concatenate with **no separator** (§3, rule 1). */
export const joinCharacterStrings = (strings: readonly string[]): string => strings.join('')

/** Resolver JSON APIs hand back zone-file RDATA: `"chunk one" "chunk two"`. Shared, so both adapters agree. */
export function parseCharacterStrings(rdata: string): string {
  const chunks = [...rdata.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((m) =>
    (m[1] ?? '').replace(/\\(\d{3}|.)/g, (_, esc: string) =>
      /^\d{3}$/.test(esc) ? String.fromCharCode(Number.parseInt(esc, 10)) : esc,
    ),
  )
  return chunks.length > 0 ? joinCharacterStrings(chunks) : rdata
}
