import { describe, expect, it } from 'vitest'
import { RESOLVERS } from '@deed/core'
import { CONTRACT_CASES, type ContractHarness } from './contract'
import { dohHarness, sandboxHarness } from './harnesses'

/**
 * The contract suite itself runs in `doh.test.ts` and `sandbox.test.ts`. What is
 * asserted here is the thing a shared suite can still get wrong: one adapter
 * quietly not implementing a case the other passes.
 */
describe('the two adapters are interchangeable', () => {
  it('One contract suite, run against both adapters', async () => {
    const harnesses: ContractHarness[] = [dohHarness, sandboxHarness]

    for (const harness of harnesses) {
      for (const kase of CONTRACT_CASES) {
        const staged = await harness.stage(kase)
        expect(staged.host, `${harness.name} did not stage ${kase}`).toBeTruthy()

        // Every case must answer for every resolver. An adapter that returns two
        // answers where the other returns three is not the same port.
        const answers = await staged.port.lookup(staged.host, 'TXT', { now: staged.now })
        expect(answers.map((a) => a.resolver).sort(), `${harness.name}/${kase}`).toEqual(
          [...RESOLVERS].sort(),
        )
      }
    }
  })

  it('neither adapter can skip a case by omitting it', () => {
    // The case list is the contract. Adding a case obliges both harnesses at
    // once, because `stage` switches exhaustively over it and `tsc` says so.
    expect(new Set(CONTRACT_CASES).size).toBe(CONTRACT_CASES.length)
  })
})
