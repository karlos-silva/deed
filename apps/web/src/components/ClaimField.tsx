'use client'

import { useEffect, useRef, useState } from 'react'
import { PreflightSteps } from '@/components/PreflightSteps'
import { type PreflightFindings, preflightSteps } from '@/lib/preflightSteps'

/** `/api/preflight` returns the whole `Preflight`, plus the parsed name's unicode form. */
type Preflight =
  | ({ ok: true; unicode: string | null } & PreflightFindings)
  | { ok: false; reason: string }

// Not `parseClaim`: it carries the 140KB Public Suffix List. A shape check decides whether to ask the server.
const PLAUSIBLE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

/** What was typed, as a name — one definition, so the lookup and the checks on
 *  screen are about the same string. */
const asName = (typed: string): string =>
  typed.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? ''

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
    const name = asName(value)
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

  const name = asName(value)
  const answer = found?.ok === true ? found : null
  const steps = looking || answer !== null ? preflightSteps(name, answer) : null
  const problem = steps?.some((step) => step.state === 'failed') === true

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
        {steps !== null && (
          <>
            <p className="t-small subtle" style={{ marginBottom: 'var(--space-3)' }}>
              {looking ? 'Reading the zone…' : 'What we found before you claim it'}
            </p>
            <PreflightSteps steps={steps} busy={looking} />
          </>
        )}

        {answer?.unicode != null && (
          <p className="t-small subtle" style={{ marginTop: 'var(--space-3)' }}>
            Stored as punycode; displays as <span className="t-mono">{answer.unicode}</span>.
          </p>
        )}

        {problem && (
          <p className="t-small subtle" style={{ marginTop: 'var(--space-3)' }}>
            None of this stops you claiming the domain.
          </p>
        )}
      </div>
    </>
  )
}
