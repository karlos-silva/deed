#!/usr/bin/env node
/**
 * Fails the build if a server-only secret reached a client chunk.
 *
 * This is failure #3 on the delivery plan's list — "a secret in the client
 * bundle; the service key is one `NEXT_PUBLIC_` away at all times" — and it is
 * the one mistake that is only detectable at build time and only catastrophic
 * after deploy. So it is wired in S0, before there is anything to leak.
 *
 * It lives inside `apps/web` rather than at the repo root on purpose: the build
 * runs with `apps/web` as its root directory, and a build step that reaches
 * outside it is a build step that can vanish depending on how the platform
 * uploads the repository.
 *
 *   node scripts/scan-bundle.mjs [.next]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const app = new URL('..', import.meta.url).pathname
const build = process.argv[2] ?? join(app, '.next')

/** Anything here in a browser-served file is a leak, not a false positive. */
const FORBIDDEN = [
  { name: 'Supabase secret key', pattern: /\bsb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: 'service-role JWT', pattern: /"role"\s*:\s*"service_role"/ },
  // A JWT whose payload decodes to the service role, base64url-encoded.
  { name: 'service-role JWT (encoded)', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl/ },
  { name: 'SUPABASE_SECRET_KEY value', pattern: /SUPABASE_SECRET_KEY["']?\s*[:=]\s*["'][^"']{8,}/ },
  { name: 'SWEEP_SECRET value', pattern: /SWEEP_SECRET["']?\s*[:=]\s*["'][^"']{4,}/ },
]

/** Only what a browser can actually download. */
const CLIENT_DIRS = ['static']

const findings = []
let scanned = 0

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      walk(path)
      continue
    }
    if (!/\.(js|mjs|cjs|json|css|map|html|txt)$/.test(entry)) continue
    scanned += 1
    const source = readFileSync(path, 'utf8')
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(source)) findings.push({ path, rule: rule.name })
    }
  }
}

for (const dir of CLIENT_DIRS) walk(join(build, dir))

if (scanned === 0) {
  console.error(`No client assets found under ${build}. Did the build run?`)
  process.exit(1)
}

if (findings.length > 0) {
  console.error(`\nA server-only secret reached the client bundle:\n`)
  for (const finding of findings) console.error(`  ${finding.rule}\n    ${finding.path}`)
  console.error('\nRefusing to ship. Move it off NEXT_PUBLIC_ and out of any client component.\n')
  process.exit(1)
}

console.log(`no secrets in ${scanned} client assets`)
