import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * The claim in state-model §6 — "adding a status must break the build at every
 * site that needs updating" — is the entire reason `RecordState` is a
 * discriminated union rather than a string enum. Asserting it in prose is worth
 * nothing, so this compiles a copy of the core with an extra variant grafted on
 * and checks that `tsc` refuses it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'src')
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
const workspaces: string[] = []

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true })
})

function compileWithExtraVariant(variant: string | null): { code: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'core-exhaustiveness-'))
  workspaces.push(dir)
  cpSync(src, join(dir, 'src'), { recursive: true })

  if (variant !== null) {
    const file = join(dir, 'src/model/record.ts')
    const patched = readFileSync(file, 'utf8').replace(
      "  | { readonly status: 'unchecked' }",
      `  | { readonly status: 'unchecked' }\n  | ${variant}`,
    )
    writeFileSync(file, patched)
  }

  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        lib: ['ES2023', 'DOM'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      include: ['src'],
    }),
  )

  const run = spawnSync(process.execPath, [tsc, '--noEmit', '-p', dir], { encoding: 'utf8' })
  return { code: run.status ?? -1, output: `${run.stdout}${run.stderr}` }
}

describe('exhaustiveness is enforced by the compiler', () => {
  it('Adding a status breaks the build', () => {
    const clean = compileWithExtraVariant(null)
    expect(clean.output).toBe('')
    expect(clean.code).toBe(0)

    const broken = compileWithExtraVariant("{ readonly status: 'quantum' }")
    expect(broken.code).not.toBe(0)

    // Not merely "somewhere": at every site that switches over the union.
    expect(broken.output).toContain('src/reduce.ts')
    expect(broken.output).toContain('src/derive/record.ts')
  }, 120_000)
})
