import { spawnSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'
const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
const flags = new Set(process.argv.slice(2))
if (flags.has('--help')) {
  console.log('Usage: pnpm electron:demo [--skip-build] [--smoke]\nOpens a fresh isolated native app with shared mock data. Close the window to stop.\n--skip-build reuses the previous demo build; --smoke verifies IPC and exits.')
  process.exit(0)
}
if ([...flags].some(flag => !['--skip-build', '--smoke'].includes(flag))) {
  console.error('Unknown option. Use --help for Electron demo usage.')
  process.exit(1)
}
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
if (!process.argv.includes('--skip-build')) {
  for (const args of [
    ['-F', '@traderalice/guardian-runtime', 'build'],
    ['-F', '@traderalice/connector-protocol', 'build'],
    ['electron:tsc'],
    ['-F', 'open-alice-ui', 'exec', 'tsc', '-b'],
    ['-F', 'open-alice-ui', 'exec', 'vite', 'build', '--mode', 'demo', '--outDir', 'dist-demo'],
  ]) {
    const result = spawnSync(pnpm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
  await build({
    entry: { backend: fileURLToPath(new URL('../../ui/src/demo/electron-backend.ts', import.meta.url)) },
    outDir: fileURLToPath(new URL('../../dist/demo', import.meta.url)),
    format: ['esm'], outExtension: () => ({ js: '.mjs' }),
    platform: 'node', target: 'node22', noExternal: [/.*/], splitting: false,
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  })
}
const child = spawn(require('electron'), [fileURLToPath(new URL('../../dist/electron/demo-main.js', import.meta.url)), ...(process.argv.includes('--smoke') ? ['--demo-smoke'] : [])], {
  cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => { process.exitCode = code ?? 1 })
