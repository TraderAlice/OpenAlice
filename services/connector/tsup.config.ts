import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { connector: 'src/main.ts' },
  format: ['cjs'],
  outDir: 'dist',
  target: 'es2023',
  sourcemap: true,
  clean: true,
  splitting: false,
  // Connector Service is a separately supervised deployable. Bundle its JS
  // SDKs (discord.js / grammY / Hono / protocol) so Docker and Electron do not
  // depend on pnpm workspace symlinks surviving prune/package collection.
  noExternal: [/.*/],
  outExtension: () => ({ js: '.cjs' }),
  esbuildOptions: (options) => {
    options.conditions = ['openalice-source', ...(options.conditions ?? [])]
  },
})
