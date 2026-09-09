'use client'

import { useEffect, useRef, useState } from 'react'
import type { PreflightWarning, Provider } from '@deed/core'
import { warningCopy } from '@/lib/copy'

type Preflight =
  | { ok: true; provider: Provider | null; warnings: PreflightWarning[]; unicode: string | null }
  | { ok: false; reason: string }

// Not `parseClaim`: it carries the 140KB Public Suffix List. A shape check decides whether to ask the server.
const PLAUSIBLE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

export function ClaimField({ initialValue = '' }: { initialValue?: string }) {
  // Seeded, because a refusal is a full navigation: the dialog reopens from the
  // query string, and an empty field would mean being told a value is wrong
  // while no longer being able to see it.
  const [value, setValue] = useState(initialValue)
  const [found, setFound] = useState<Preflight | null>(null)
  const [looking, setLooking] = useState(false)
  // The answer, not just the time it was asked: on a cache hit the old code
  // returned early without re-serving anything, so the previous name's verdict
  // stayed on screen describing a domain nobody was typing.
  const asked = useRef(new Map<string, { at: number; result: Preflight }>())

  useEffect(() => {
    const name = value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? ''
    if (!PLAUSIBLE.test(name)) {
      setFound(null)
      return
    }

    // At most once per minute per name: every call is a real lookup against shared public resolvers.
    const cached = asked.current.get(name)
    if (cached !== undefined && Date.now() - cached.at < 60_000) {
      setFound(cached.result)
      setLooking(false)
      return
    }

    // Whatever is on screen is about a different name until the answer lands.
    setFound(null)

    const timer = setTimeout(() => {
      setLooking(true)
      fetch(`/api/preflight?name=${encodeURIComponent(name)}`)
        .then((response) => response.json() as Promise<Preflight>)
        .then((result) => {
          asked.current.set(name, { at: Date.now(), result })
          setFound(result)
        })
        .catch(() => {
          setFound(null)
        })
        .finally(() => {
          setLooking(false)
        })
    }, 700)

    return () => {
      clearTimeout(timer)
    }
  }, [value])

  const rendered = found?.ok === true ? found.warnings.map(warningCopy) : []

  return (
    <>
      <div className="field wide">
        <label className="t-label" htmlFor="domain">
          Domain
        </label>
        <input
          className="input"
          id="domain"
          name="domain"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
          }}
          // Otherwise the dialog's focus delegate is the first focusable in
          // tree order — the Esc button — not the field it was opened to fill.
          autoFocus
          placeholder="acme.com — or acme.test to try it without owning one"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby="preflight"
          required
        />
      </div>

      <div id="preflight" aria-live="polite" style={{ flexBasis: '100%', minWidth: 0 }}>
        {looking && <p className="t-small subtle">Reading the zone…</p>}

        {found?.ok === true && found.provider !== null && (
          <p className="t-small subtle">
            This zone is on <strong>{found.provider.name}</strong>. The instructions will use its own
            field names.
          </p>
        )}

        {found?.ok === true && found.unicode !== null && (
          <p className="t-small subtle">
            Stored as punycode; displays as <span className="t-mono">{found.unicode}</span>.
          </p>
        )}

        {rendered.map((warning, index) => (
          <div
            key={index}
            className={`callout callout-${warning.tone === 'problem' ? 'warning' : 'info'}`}
            style={{ marginTop: 'var(--space-2)' }}
          >
            <div className="guidance">
              <strong className="headline" style={{ fontSize: 'var(--text-base)' }}>
                {warning.headline}
              </strong>
              <p className="body">{warning.body}</p>
              {warning.fix !== undefined && <p className="fix">{warning.fix}</p>}
            </div>
          </div>
        ))}

        {rendered.length > 0 && (
          <p className="t-small subtle" style={{ marginTop: 'var(--space-2)' }}>
            None of this stops you claiming the domain.
          </p>
        )}
      </div>
    </>
  )
}
