// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * The mechanical guardrails from delivery-plan.md § Definition of done.
 * Every rule here exists because a human remembering is not a guardrail.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'coverage/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A new variant in RecordState must break the build at every site that
      // switches over it — the entire reason these are discriminated unions.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
    },
  },

  {
    // state-model §6 / delivery-plan: packages/core is pure. The purity claim is
    // enforced, not asserted.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'packages/core has no I/O (state-model §6).' },
            { group: ['@supabase/*'], message: 'packages/core has no I/O (state-model §6).' },
            { group: ['@deed/db', '@deed/dns'], message: 'The core depends on nothing.' },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'packages/core has no I/O (state-model §6).' },
        { name: 'process', message: 'packages/core reads no environment.' },
        { name: 'document', message: 'packages/core has no UI (D7).' },
        { name: 'window', message: 'packages/core has no UI (D7).' },
        { name: 'localStorage', message: 'packages/core has no I/O (state-model §6).' },
        { name: 'crypto', message: 'packages/core has no randomness; tokens are minted outside it.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "`now` arrives as a parameter (state-model §4, invariant 9).",
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: "`now` arrives as a parameter (state-model §4, invariant 9).",
        },
      ],
    },
  },

  {
    // Plain scripts: linted for correctness, but they are not in a tsconfig and
    // type-aware rules have nothing to work with.
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { parserOptions: { projectService: false } },
    rules: { 'no-undef': 'off' },
  },

  {
    files: ['**/test/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
)
