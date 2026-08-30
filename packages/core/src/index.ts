/**
 * `packages/core` — the state machine, diagnosis, and diff. Zero I/O.
 *
 * The normative specification is docs/state-model.md. Where a comment cites a
 * section, that section is the contract and this is its implementation.
 */

export * from './time'
export * from './recordSpec'
export * from './txt'
export * from './name'
export * from './cadence'
export * from './reduce'

export * from './model/ids'
export * from './model/record'
export * from './model/domain'
export * from './model/observation'
export * from './model/audit'

export * from './derive/classify'
export * from './derive/record'

export * from './diagnose/cause'
export * from './diagnose/diff'
