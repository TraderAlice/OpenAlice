#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')
const packageRoot = resolve(repoRoot, 'dist', 'electron-app')

const resourceRootCandidates = [
  'mac-arm64/OpenAlice.app/Contents/Resources/app',
  'mac/OpenAlice.app/Contents/Resources/app',
  'OpenAlice.app/Contents/Resources/app',
  'win-unpacked/resources/app',
  'linux-unpacked/resources/app',
].map((p) => resolve(packageRoot, p))

const requiredFiles = [
  'package.json',
  'dist/main.js',
  'dist/electron/main.js',
  'ui/dist/index.html',
  'services/uta/dist/uta.js',
  'src/workspaces/cli/bin/alice',
  'src/workspaces/cli/bin/alice.cmd',
  'src/workspaces/templates/_common.mjs',
  'src/workspaces/templates/chat/bootstrap.mjs',
  'vendor/manifest.json',
  'vendor/pi/package.json',
  'vendor/pi/package-lock.json',
  'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
]

const appRoot = resourceRootCandidates.find((p) => existsSync(join(p, 'package.json')))
if (!appRoot) {
  console.error('[desktop-package] app resources root not found. Checked:')
  for (const candidate of resourceRootCandidates) {
    console.error(`  - ${relative(repoRoot, candidate)}`)
  }
  process.exit(1)
}

const missing = requiredFiles.filter((file) => !existsSync(join(appRoot, file)))
if (missing.length > 0) {
  console.error(`[desktop-package] ${relative(repoRoot, appRoot)} is missing required packaged files:`)
  for (const file of missing) console.error(`  - ${file}`)
  process.exit(1)
}

const manifestPath = join(appRoot, 'vendor', 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest?.pi?.mode !== 'npm') {
  console.error(`[desktop-package] expected manifest.pi.mode="npm", got ${JSON.stringify(manifest?.pi?.mode)}`)
  process.exit(1)
}
if (manifest?.pi?.cli !== 'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js') {
  console.error(`[desktop-package] unexpected manifest.pi.cli: ${JSON.stringify(manifest?.pi?.cli)}`)
  process.exit(1)
}

console.log(`[desktop-package] app resources OK: ${relative(repoRoot, appRoot)}`)
console.log(`[desktop-package] managed Pi: ${manifest.pi.version} (${manifest.pi.mode})`)
