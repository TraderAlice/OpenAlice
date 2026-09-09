// No credentials or network: exercise a detached pack through compiled Bun.
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = await mkdtemp(join(tmpdir(), 'alpaca-compiled-smoke-'))
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 120_000 })
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error ?? result.stderr ?? result.stdout}`)
  return result.stdout
}
try {
  const entry = join(root, 'pack.mjs')
  await copyFile(fileURLToPath(new URL('./dist/index.js', import.meta.url)), entry)
  const probe = join(root, 'probe.ts')
  await writeFile(probe, `
const pack = await import(process.argv[2]);
if (pack.BROKER_ENGINE !== 'alpaca' || pack.BROKER_PACK_API_VERSION !== 1) throw new Error('Invalid pack exports');
const broker = pack.createBroker({ id: 'offline-smoke', brokerConfig: { paper: true } });
if (typeof broker.init !== 'function' || typeof broker.getAccount !== 'function') throw new Error('Invalid broker');
await broker.close();
console.log('ALPACA_COMPILED_IMPORT_OK');
`)
  const binary = join(root, process.platform === 'win32' ? 'probe.exe' : 'probe')
  run('bun', ['build', probe, '--compile', '--outfile', binary])
  const output = run(binary, [entry])
  if (!output.includes('ALPACA_COMPILED_IMPORT_OK')) throw new Error('Missing acceptance receipt')
  console.log(output.trim())
} finally {
  await rm(root, { recursive: true, force: true })
}
