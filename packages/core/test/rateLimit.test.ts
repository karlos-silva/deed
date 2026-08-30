import { describe, expect, it } from 'vitest'
import { CHECK_NOW_COOLDOWN, USER_LOOKUP_BUDGET, at, minus, seconds } from '../src/time'
import { checkNowDecision } from '../src/rateLimit'

const NOW = at(1_767_225_600_000)

describe('check now', () => {
  it('Check now is limited, honest, and reveals nothing', () => {
    // The first is allowed.
    expect(checkNowDecision({ lastManualCheck: null, spentThisHour: 0, now: NOW })).toEqual({
      allowed: true,
    })

    // The second inside the limit is refused, and says how long is left rather
    // than simply saying no.
    const justNow = minus(NOW, seconds(8))
    const refusal = checkNowDecision({ lastManualCheck: justNow, spentThisHour: 1, now: NOW })
    expect(refusal).toEqual({ allowed: false, reason: 'cooldown', retryInSeconds: 22 })

    // A refusal is a refusal. It never hands back a cached verdict dressed up as
    // a fresh one — there is no result in it to mistake for one.
    expect(Object.keys(refusal).sort()).toEqual(['allowed', 'reason', 'retryInSeconds'])

    // And it discloses nothing: the decision cannot mention a domain, because it
    // is never told about one. A refusal that differed for a domain that exists,
    // or for one held by somebody else, would answer a question the caller has
    // not earned the right to ask (S4).
    const foreign = checkNowDecision({ lastManualCheck: justNow, spentThisHour: 1, now: NOW })
    const missing = checkNowDecision({ lastManualCheck: justNow, spentThisHour: 1, now: NOW })
    expect(foreign).toEqual(missing)

    // Once the cooldown has passed, it is allowed again.
    const later = at(NOW + CHECK_NOW_COOLDOWN)
    expect(checkNowDecision({ lastManualCheck: NOW, spentThisHour: 1, now: later })).toEqual({
      allowed: true,
    })
  })

  it('the hourly budget is separate from the per-domain cooldown', () => {
    // Long past the cooldown, but out of budget for the hour.
    const decision = checkNowDecision({
      lastManualCheck: minus(NOW, seconds(3_600)),
      spentThisHour: USER_LOOKUP_BUDGET,
      now: NOW,
    })
    expect(decision).toEqual({ allowed: false, reason: 'budget', perHour: USER_LOOKUP_BUDGET })
  })

  it('the cooldown is measured, not rounded away', () => {
    // One millisecond inside the window is still inside it.
    const edge = at(NOW + CHECK_NOW_COOLDOWN - 1)
    expect(checkNowDecision({ lastManualCheck: NOW, spentThisHour: 0, now: edge }).allowed).toBe(false)
    expect(
      checkNowDecision({ lastManualCheck: NOW, spentThisHour: 0, now: at(NOW + CHECK_NOW_COOLDOWN) })
        .allowed,
    ).toBe(true)
  })
})
