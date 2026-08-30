#!/usr/bin/env node
/**
 * Captures the DoH contract fixtures from real resolvers and commits them.
 *
 * The contract suite runs against these rather than the live network (D12, S2):
 * a third party's outage must not turn our CI red, but the shapes the adapter
 * parses have to be shapes a resolver actually produced. Re-run this when a
 * fixture looks stale; the diff is the evidence.
 *
 *   node scripts/capture-doh-fixtures.mjs [YYYY-MM-DD]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'packages/dns/test/fixtures')
const capturedAt = process.argv[2] ?? new Date().toISOString().slice(0, 10)

/** Each case names a real host that produces it. Nothing here is invented. */
const CASES = [
  {
    name: 'single-value',
    host: 'mail.google.com',
    note: 'Exactly one TXT record — the ordinary case.',
  },
  {
    name: 'multiple-records',
    host: 'example.com',
    note: 'Two TXT records at one host: ours has to be found among them, not alone.',
  },
  {
    name: 'chunked-value',
    host: 'protonmail._domainkey.proton.me',
    note: 'A 2048-bit DKIM key: over 255 bytes, so it arrives as two character-strings.',
  },
  { name: 'nxdomain', host: 'nonexistent-xyzzy-9f3a.iana.org', note: 'The name does not exist.' },
  { name: 'nodata', host: 'www.example.com', note: 'The name exists and holds no TXT.' },
  {
    name: 'cname-at-host',
    host: 'selector1._domainkey.microsoft.com',
    note: 'A CNAME at the host, which is why no TXT resolves there.',
  },
  {
    name: 'dnssec-failure',
    host: 'dnssec-failed.org',
    note: 'SERVFAIL carrying an EDE code: their zone, not our lookup.',
  },
]

const ENDPOINTS = [
  {
    resolver: 'cloudflare',
    url: (h) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(h)}&type=TXT`,
  },
  {
    resolver: 'google',
    url: (h) => `https://dns.google/resolve?name=${encodeURIComponent(h)}&type=TXT`,
  },
  {
    resolver: 'adguard',
    url: (h) => `https://unfiltered.adguard-dns.com/resolve?name=${encodeURIComponent(h)}&type=TXT`,
  },
]

mkdirSync(out, { recursive: true })

for (const kase of CASES) {
  const responses = {}
  for (const endpoint of ENDPOINTS) {
    const response = await fetch(endpoint.url(kase.host), {
      headers: { accept: 'application/dns-json' },
    })
    if (!response.ok) {
      console.error(`  ! ${endpoint.resolver} ${response.status} — skipped`)
      continue
    }
    responses[endpoint.resolver] = { body: await response.json() }
  }
  const file = join(out, `${kase.name}.json`)
  writeFileSync(
    file,
    `${JSON.stringify({ case: kase.name, host: kase.host, note: kase.note, capturedAt, responses }, null, 2)}\n`,
  )
  console.log(`${kase.name}  ${Object.keys(responses).join(', ')}`)
}
