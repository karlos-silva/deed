import { TOKEN_LENGTH, type Token, token } from '@deed/core'

/**
 * 32 random bytes, base32-encoded lowercase without padding — 52 characters,
 * safe in any DNS panel (prd §4).
 *
 * Randomness is I/O-shaped, so it lives here rather than in the core. The core
 * only ever *validates* a token's shape.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

export function mintToken(): Token {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)

  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]

  return token(out.slice(0, TOKEN_LENGTH))
}
