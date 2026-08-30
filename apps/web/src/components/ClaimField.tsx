'use client'

import { useEffect, useRef, useState } from 'react'
import type { PreflightWarning, Provider } from '@deed/core'
import { warningCopy } from '@/lib/copy'

type Preflight =
  | { ok: true; provider: Provider | null; warnings: PreflightWarning[]; unicode: string | null }
  | { ok: false; reason: string }

/**
 * Pre-flight runs as they type — debounced to pauses on a plausible name, never
 * per keystroke, and never twice for the same name (state-model §5). Every call
 * is a real lookup against shared public resolvers, so the restraint is the
 * point, not politeness.
 *
 * Deliberately *not* using `parseClaim` here: it carries the Public Suffix List,
 * and shipping 140KB of it to the browser to decide whether to debounce would
 * cost more than the feature saves. A cheap shape check is enough to decide
 * whether asking the server is worth it; the server does the real parsing.
 */
const PLAUSIBLE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

export function ClaimField() {
  const [value, setValue] = useState('')
  const [found, setFound] = useState<Preflight | null>(null)
  const [looking, setLooking] = useState(false)
  const asked = useRef(new Map<string, number>())

  useEffect(() => {
    const name = value.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? ''
    if (!PLAUSIBLE.test(name)) {
      setFound(null)
      return
    }

    // At most once per minute per distinct name: retyping the same domain must
    // not re-ask, and neither must a re-render.
    const lastAsked = asked.current.get(name)
    if (lastAsked !== undefined && Date.now() - lastAsked < 60_000) return

    const timer = setTimeout(() => {
      asked.current.set(name, Date.now())
      setLooking(true)
      fetch(`/api/preflight?name=${encodeURIComponent(name)}`)
        .then((response) => response.json() as Promise<Preflight>)
        .then(setFound)
        .catch(() => {
          // A failed pre-flight is not a verdict about their zone, and must not
          // be shown as one.
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
          // Pre-flight never blocks. It tells you what it saw; claiming is
          // still yours to do (S5).
          <p className="t-small subtle" style={{ marginTop: 'var(--space-2)' }}>
            None of this stops you claiming the domain.
          </p>
        )}
      </div>
    </>
  )
}
