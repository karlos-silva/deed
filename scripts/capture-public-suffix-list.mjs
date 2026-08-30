#!/usr/bin/env node
/**
 * Vendors the Public Suffix List into `packages/core`.
 *
 * It is committed rather than fetched at runtime for two reasons: `packages/core`
 * has no I/O by construction (state-model §6), and a verification product must
 * not change its mind about what `co.uk` is because a CDN had a bad minute.
 *
 * The property test in S3 samples this file directly, so the list growing is a
 * diff we can read rather than a dependency upgrade we cannot.
 *
 *   node scripts/capture-public-suffix-list.mjs [YYYY-MM-DD]
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = 'https://publicsuffix.org/list/public_suffix_list.dat'
const root = new URL('..', import.meta.url).pathname
const capturedAt = process.argv[2] ?? new Date().toISOString().slice(0, 10)

const response = await fetch(SOURCE)
if (!response.ok) throw new Error(`${SOURCE} responded ${response.status}`)

/**
 * Rules are canonicalised to punycode. The list ships many of them in Unicode
 * (`høyanger.no`), and names are stored punycode-first (prd §8), so comparing
 * the two forms would silently let a public suffix through. A property test
 * caught exactly that.
 */
const toPunycode = (rule) => {
  const wildcard = rule.startsWith('*.')
  const exception = rule.startsWith('!')
  const bare = wildcard ? rule.slice(2) : exception ? rule.slice(1) : rule
  const encoded = new URL(`https://${bare}`).hostname
  return `${wildcard ? '*.' : ''}${exception ? '!' : ''}${encoded}`
}

const rules = (await response.text())
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('//'))
  .map(toPunycode)

const out = join(root, 'packages/core/src/data/publicSuffixList.ts')
writeFileSync(
  out,
  `/**
 * The Public Suffix List, vendored — see scripts/capture-public-suffix-list.mjs.
 *
 * Source:   ${SOURCE}
 * Captured: ${capturedAt}
 * Rules:    ${rules.length}
 *
 * Comments and blank lines are stripped and every rule is canonicalised to
 * punycode; wildcard (\`*.\`) and exception (\`!\`) prefixes are kept, because
 * both change the answer.
 */
export const PUBLIC_SUFFIX_RULES = \`${rules.join('\n')}\`
  .split('\\n')

export const PUBLIC_SUFFIX_LIST_CAPTURED_AT = '${capturedAt}'
`,
)
console.log(`${rules.length} rules → ${out}`)
