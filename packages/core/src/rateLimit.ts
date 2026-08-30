import {
  CHECK_NOW_COOLDOWN,
  USER_LOOKUP_BUDGET,
  type Timestamp,
  minus,
  hours,
} from './time'

/**
 * A value the UI can render, not a thrown error: the refusal shows the time remaining (state-model §5).
 * Takes no domain identity and no ownership state — the shape is the disclosure guarantee, not a check inside it.
 */
export type CheckNowDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'cooldown'; readonly retryInSeconds: number }
  | { readonly allowed: false; readonly reason: 'budget'; readonly perHour: number }

export type CheckNowInputs = {
  readonly lastManualCheck: Timestamp | null
  /** User-triggered checks *and* pre-flights in the last hour. */
  readonly spentThisHour: number
  readonly now: Timestamp
}

export function checkNowDecision(inputs: CheckNowInputs): CheckNowDecision {
  const { lastManualCheck, spentThisHour, now } = inputs

  if (lastManualCheck !== null && now - lastManualCheck < CHECK_NOW_COOLDOWN) {
    const remaining = CHECK_NOW_COOLDOWN - (now - lastManualCheck)
    return { allowed: false, reason: 'cooldown', retryInSeconds: Math.ceil(remaining / 1_000) }
  }

  if (spentThisHour >= USER_LOOKUP_BUDGET) {
    return { allowed: false, reason: 'budget', perHour: USER_LOOKUP_BUDGET }
  }

  return { allowed: true }
}

export const budgetWindowStart = (now: Timestamp): Timestamp => minus(now, hours(1))
