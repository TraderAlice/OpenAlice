import { defineConfig } from 'tsup'
export default defineConfig({
  entry: { index: 'src/index.ts' }, format: ['esm'], outDir: 'dist', target: 'node20',
  clean: true, sourcemap: true, splitting: false, skipNodeModulesBundle: false,
  // Compiled Bun cannot resolve this deployed SDK tree reliably. Keep the
  // pure-JS Alpaca dependency closure inside the pack, including CJS helpers.
  noExternal: [/.*/],
  banner: { js: "import { createRequire as __oaCreateRequire } from 'node:module'; const require = __oaCreateRequire(import.meta.url);" },
  esbuildOptions: (options) => { options.conditions = ['openalice-source', ...(options.conditions ?? [])] },
})
