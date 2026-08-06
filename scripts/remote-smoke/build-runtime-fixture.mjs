#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import {
  fileSha256,
  writeRuntimeBundleManifest,
} from '../../packages/cli/src/runtime-bundle.mjs'

const fixtureRoot = '/fixture'
const runtimeAssets = join(fixtureRoot, 'runtime-assets')
const archiveParent = join(runtimeAssets, 'archive')
const runtimeRoot = join(archiveParent, 'openalice-runtime')
const productVersion = JSON.parse(
  await readFile(join(fixtureRoot, 'packages/cli/package.json'), 'utf8'),
).version

for (const path of [
  'dist',
  'ui/dist',
  'default',
  'src/workspaces/templates',
  'src/workspaces/cli/bin',
  'services/uta/dist',
  'services/connector/dist',
  'packages/guardian-runtime/dist',
  'scripts/guardian',
  'node_modules',
]) {
  await mkdir(join(runtimeRoot, path), { recursive: true })
}

const files = new Map([
  ['dist/main.js', 'export {}\n'],
  ['ui/dist/index.html', '<!doctype html><title>OpenAlice remote fixture</title>\n'],
  ['default/persona.default.md', '# OpenAlice\n'],
  ['src/workspaces/templates/.keep', 'fixture\n'],
  ['src/workspaces/cli/bin/openalice-cli.cjs', 'module.exports = {}\n'],
  ['src/workspaces/cli/bin/pi-session-provider.ts', 'export {}\n'],
  ['services/uta/dist/uta.js', 'export {}\n'],
  ['services/connector/dist/connector.cjs', 'module.exports = {}\n'],
  ['packages/guardian-runtime/dist/index.js', 'export {}\n'],
  ['scripts/guardian/prod-ports.mjs', 'export {}\n'],
  ['node_modules/.keep', 'fixture\n'],
  ['package.json', JSON.stringify({
    name: 'open-alice',
    version: productVersion,
    type: 'module',
    scripts: { 'build:server': 'true' },
  }) + '\n'],
])
for (const [path, content] of files) {
  await writeFile(join(runtimeRoot, path), content)
}
await writeFile(
  join(runtimeRoot, 'scripts/guardian/prod.mjs'),
  await readFile(join(fixtureRoot, 'OpenAlice/scripts/guardian/prod.mjs')),
)
await writeFile(
  join(runtimeRoot, 'scripts/guardian/control-server.mjs'),
  await readFile(join(fixtureRoot, 'OpenAlice/scripts/guardian/control-server.mjs')),
)

const manifest = await writeRuntimeBundleManifest(runtimeRoot, {
  productVersion,
  platform: process.platform,
  arch: process.arch,
})
const archiveName = [
  'openalice-runtime',
  productVersion,
  process.platform,
  process.arch,
  manifest.contentIdentity,
].join('-') + '.tar.gz'
const archivePath = join(runtimeAssets, archiveName)
const tar = spawnSync('tar', [
  '-czf',
  archivePath,
  '-C',
  archiveParent,
  'openalice-runtime',
], { stdio: 'inherit' })
if (tar.error) throw tar.error
if (tar.status !== 0) throw new Error(`tar exited ${String(tar.status)}`)
const archiveSha256 = await fileSha256(archivePath)
const archiveSize = await stat(archivePath)
await writeFile(
  join(
    runtimeAssets,
    `openalice-runtime-${productVersion}-${process.platform}-${process.arch}.json`,
  ),
  JSON.stringify({
    schemaVersion: 1,
    productVersion,
    platform: process.platform,
    arch: process.arch,
    node: { minimumVersion: '22.19.0' },
    runtimeContentIdentity: manifest.contentIdentity,
    archive: {
      file: archiveName,
      size: archiveSize.size,
      sha256: archiveSha256,
    },
  }, null, 2) + '\n',
)
