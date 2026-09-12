import { spawn, spawnSync } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const args = new Set(process.argv.slice(2))
const checkOnly = args.has('--check')
const noOpen = args.has('--no-open') || process.env['CI'] === 'true'
const portArg = process.argv.find((value) => value.startsWith('--port='))
const port = portArg?.slice('--port='.length) || '4173'
const root = process.cwd()

const build = spawnSync('pnpm', ['-F', 'open-alice-ui', 'build:demo'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (build.status !== 0) process.exit(build.status ?? 1)

await access(resolve(root, 'ui/dist/index.html'))
const assets = await readFile(resolve(root, 'ui/dist/index.html'), 'utf8')
if (!assets.includes('/assets/')) throw new Error('Demo build did not produce an application bundle')

if (checkOnly) {
  console.log('Market Evidence Monitor demo build is ready at /market/evidence')
  process.exit(0)
}

const url = `http://127.0.0.1:${port}/market/evidence`
console.log(`Market Evidence Monitor: ${url}`)
const server = spawn('pnpm', ['-F', 'open-alice-ui', 'preview', '--host', '127.0.0.1', '--port', port], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (!noOpen) {
  const opener = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]]
  setTimeout(() => spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref(), 1200)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal))
}
server.on('exit', (code) => process.exit(code ?? 0))
