import {
  CHECK_NOW_COOLDOWN,
  USER_LOOKUP_BUDGET,
  type Timestamp,
  minus,
  hours,
} from './time'

/**
 * Rate limits are product surface, not infrastructure trivia (state-model §5):
 * the refusal shows the time remaining, so it has to be a value the UI can
 * render rather than a thrown error.
 *
 * Deliberately, the decision takes no domain identity and no ownership state.
 * A refusal that varied by whether the domain existed, or by who held it, would
 * answer a question the caller has not earned the right to ask — so the shape of
 * this function is the disclosure guarantee, not a check inside it.
 */
export type CheckNowDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'cooldown'; readonly retryInSeconds: number }
  | { readonly allowed: false; readonly reason: 'budget'; readonly perHour: number }

export type CheckNowInputs = {
  /** When this domain was last checked on the user's own instruction. */
  readonly lastManualCheck: Timestamp | null
  /** User-triggered checks and pre-flights in the last hour. */
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

/** The window `spentThisHour` should be counted over. */
export const budgetWindowStart = (now: Timestamp): Timestamp => minus(now, hours(1))
