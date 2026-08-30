import {
  type AuditActor,
  type Observation,
  type Timestamp,
  challengeHost,
} from '@deed/core'
import type { DnsPort } from './port'

/** The probe is a random *sibling* label: a wildcard one level up need not match the challenge host (state-model §3). */
export type ObserveOptions = {
  readonly now: Timestamp
  readonly actor: AuditActor
  /** Supplied by the caller: the core holds no randomness. */
  readonly probeLabel: string
  readonly timeoutMs?: number
}

export async function observe(
  port: DnsPort,
  name: string,
  options: ObserveOptions,
): Promise<Observation> {
  const context =
    options.timeoutMs === undefined
      ? { now: options.now }
      : { now: options.now, timeoutMs: options.timeoutMs }

  const [answers, probe] = await Promise.all([
    port.lookup(challengeHost(name), 'TXT', context),
    port.lookup(`${options.probeLabel}.${name}`, 'TXT', context),
  ])

  return { startedAt: options.now, actor: options.actor, answers, probe }
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function randomProbeLabel(length = 20): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let label = ''
  for (const byte of bytes) label += ALPHABET.charAt(byte % ALPHABET.length)
  return label
}
