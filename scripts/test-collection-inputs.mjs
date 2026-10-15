import { resolve } from 'node:path'

// Catalog/config changes alter collection even when no test statically imports
// them. Every runnable lane shares the same absolute metadata triggers.
export function collectionWideTestInputs(root) {
  return [
    '**/package.json',
    '**/{vitest,vite}*.config.*',
    'scripts/{test-lanes,test-suites,test-commands,test-results,test-collection-inputs}.mjs',
    'tests/**/*.json',
  ].map(pattern => resolve(root, pattern).replaceAll('\\', '/'))
}
