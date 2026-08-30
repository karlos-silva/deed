/**
 * DNS transmits TXT values longer than 255 bytes as several character-strings
 * that concatenate with **no separator** (state-model §3, comparison rule 1).
 *
 * A 32-byte ownership token never reaches that length, so this is unreachable
 * through the product as scoped (D3). It is implemented and tested anyway,
 * because the resolver layer is a general TXT reader and a wrong answer here
 * would be a silent one.
 */
export const joinCharacterStrings = (strings: readonly string[]): string => strings.join('')

/**
 * Resolver JSON APIs hand back the RDATA as it appears in a zone file:
 * `"chunk one" "chunk two"`. Splitting on the quoting is the adapter's job;
 * this is the shared parser so both adapters agree.
 */
export function parseCharacterStrings(rdata: string): string {
  const chunks = [...rdata.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((m) =>
    (m[1] ?? '').replace(/\\(\d{3}|.)/g, (_, esc: string) =>
      /^\d{3}$/.test(esc) ? String.fromCharCode(Number.parseInt(esc, 10)) : esc,
    ),
  )
  return chunks.length > 0 ? joinCharacterStrings(chunks) : rdata
}
