import { resolve } from 'node:path'
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
  // SDKs (discord.js / grammY / Slack / Feishu / Hono / protocol) so Docker and Electron do not
  // depend on pnpm workspace symlinks surviving prune/package collection.
  noExternal: [/.*/],
  outExtension: () => ({ js: '.cjs' }),
  esbuildOptions: (options) => {
    options.conditions = ['openalice-source', ...(options.conditions ?? [])]
    // grammY's Node shim imports the legacy `abort-controller` polyfill.
    // Bundling it makes esbuild rename its AbortSignal class, which breaks
    // node-fetch@2.7.0's `constructor.name === "AbortSignal"` check and fails
    // every grammY call. Point it at Node's native global instead (runtime is
    // Node >= 22). See src/shims/abort-controller.ts.
    options.alias = {
      ...(options.alias ?? {}),
      'abort-controller': resolve(import.meta.dirname, 'src/shims/abort-controller.ts'),
    }
  },
})
