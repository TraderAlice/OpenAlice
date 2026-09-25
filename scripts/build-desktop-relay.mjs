import { readFile } from 'node:fs/promises'
import { build } from 'tsup'

const cliPackage = JSON.parse(await readFile(new URL('../packages/cli/package.json', import.meta.url), 'utf8'))

await build({
  entry: ['packages/cli/src/web-relay.ts'],
  outDir: 'dist/electron',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  splitting: false,
  clean: false,
  define: {
    'globalThis.__OPENALICE_BUILD_VERSION__': JSON.stringify(cliPackage.version),
  },
})
