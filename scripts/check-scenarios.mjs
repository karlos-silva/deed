#!/usr/bin/env node
/**
 * delivery-plan.md § Definition of done:
 *   "Every `#### Scenario:` heading here has a test of the same name. A CI
 *    script extracts the headings and fails if one has no match."
 *
 * The cheapest guardrail we have, and the one that keeps specs from quietly
 * becoming fiction. Run with `pnpm scenarios`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const plan = readFileSync(join(root, 'docs/delivery-plan.md'), 'utf8')

/** Scenario headings, tagged with the slice they belong to. */
const scenarios = []
let slice = '?'
for (const line of plan.split('\n')) {
  const s = /^## (S\d)\b/.exec(line)
  if (s) slice = s[1]
  const h = /^#### (.+?)\s*$/.exec(line)
  if (h) scenarios.push({ slice, name: h[1] })
}

/** Every test name declared anywhere in the workspace. */
const IGNORED = new Set(['node_modules', 'dist', '.next', '.turbo', '.git', 'coverage'])
const tests = new Map()
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) { walk(path); continue }
    // Test files, plus anything under a `test/` directory: shared suites live
    // there too, and a scenario asserted from one still counts.
    const inTestDir = /(^|\/)test(\/|$)/.test(relative(root, dir))
    if (!/\.(test|spec)\.[cm]?tsx?$/.test(entry) && !(inTestDir && /\.tsx?$/.test(entry))) continue
    const src = readFileSync(path, 'utf8')
    for (const m of src.matchAll(/^\s*(?:it|test)\s*(?:\.\w+)?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm)) {
      tests.set(m[2].replace(/\\(['"`])/g, '$1'), relative(root, path))
    }
  }
}
walk(root)

const missing = scenarios.filter((s) => !tests.has(s.name))
const bySlice = new Map()
for (const s of scenarios) {
  const cell = bySlice.get(s.slice) ?? { total: 0, covered: 0 }
  cell.total += 1
  if (tests.has(s.name)) cell.covered += 1
  bySlice.set(s.slice, cell)
}

for (const [name, { total, covered }] of bySlice) {
  const mark = covered === total ? '✓' : ' '
  console.log(`${mark} ${name}  ${covered}/${total}`)
}

if (missing.length > 0) {
  console.error(`\n${missing.length} scenario(s) with no test of the same name:`)
  for (const s of missing) console.error(`  ${s.slice}  ${s.name}`)
  process.exit(1)
}
console.log(`\nall ${scenarios.length} scenarios have a test of the same name`)
