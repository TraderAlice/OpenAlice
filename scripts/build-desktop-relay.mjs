import { readFile } from 'node:fs/promises'
import { build } from 'tsup'

const product = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

await build({
  entry: ['packages/cli/src/web-relay.ts'],
  outDir: 'dist/electron',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  splitting: false,
  noExternal: ['@traderalice/update-lifecycle'],
  clean: false,
  define: {
    'globalThis.__OPENALICE_BUILD_VERSION__': JSON.stringify(product.version),
  },
})
