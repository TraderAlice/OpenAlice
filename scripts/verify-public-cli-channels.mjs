#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const TARGETS = Object.freeze([
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'arm64'],
  ['linux', 'x64'],
])

export async function verifyPublicCliChannels({
  manifestPath,
  version,
  repository = 'TraderAlice/OpenAlice',
  fetchImpl = fetch,
}) {
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'))
  const expectedBase = `https://github.com/${repository}/releases/download/v${version}`
  if (manifest.schemaVersion !== 1 || manifest.version !== version) {
    throw new Error(`CLI channel manifest does not describe ${version}`)
  }
  if (manifest.assetBaseUrl !== expectedBase) {
    throw new Error(`CLI channel asset base is ${manifest.assetBaseUrl}, expected ${expectedBase}`)
  }
  if (!Array.isArray(manifest.targets) || manifest.targets.length !== TARGETS.length) {
    throw new Error(`CLI channel manifest must contain ${TARGETS.length} native targets`)
  }

  const receipts = []
  for (const [platform, arch] of TARGETS) {
    const target = manifest.targets.find((candidate) => (
      candidate?.platform === platform && candidate?.arch === arch
    ))
    if (!target || !/^[a-f0-9]{64}$/.test(target.sha256 ?? '')) {
      throw new Error(`CLI channel manifest is missing a valid ${platform}-${arch} checksum`)
    }
    if (!/^[a-f0-9]{16}$/.test(target.contentIdentity ?? '')) {
      throw new Error(`CLI channel manifest is missing a valid ${platform}-${arch} content identity`)
    }
    const archive = `openalice-cli-${version}-${platform}-${arch}.tar.gz`
    const archiveUrl = `${expectedBase}/${archive}`
    const bytes = await fetchBytes(fetchImpl, archiveUrl)
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== target.sha256) {
      throw new Error(`public ${archive} checksum is ${actual}, expected ${target.sha256}`)
    }
    const sidecar = (await fetchText(fetchImpl, `${archiveUrl}.sha256`)).trim().split(/\s+/)[0]
    if (sidecar !== target.sha256) {
      throw new Error(`public ${archive}.sha256 does not match the accepted archive`)
    }
    receipts.push({
      platform,
      arch,
      archive,
      sha256: target.sha256,
      contentIdentity: target.contentIdentity,
      public: true,
    })
  }
  return {
    schemaVersion: 1,
    status: 'pass',
    repository,
    version,
    assetBaseUrl: expectedBase,
    targets: receipts,
  }
}

async function fetchBytes(fetchImpl, url) {
  const response = await fetchWithRetry(fetchImpl, url)
  return new Uint8Array(await response.arrayBuffer())
}

async function fetchText(fetchImpl, url) {
  const response = await fetchWithRetry(fetchImpl, url)
  return response.text()
}

async function fetchWithRetry(fetchImpl, url) {
  let lastError = null
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'OpenAlice-release-verifier' },
        signal: AbortSignal.timeout(60_000),
      })
      if (response.ok) return response
      lastError = new Error(`${url} returned HTTP ${response.status}`)
      if (response.status < 500 && response.status !== 404) break
    } catch (error) {
      lastError = error
    }
    if (attempt < 4) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 1_000))
  }
  throw new Error(`public release asset is unavailable: ${url} (${String(lastError)})`)
}

export function parseArgs(argv) {
  const result = { repository: 'TraderAlice/OpenAlice' }
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!['--manifest', '--version', '--repository'].includes(name) || !value) {
      throw new Error(usage())
    }
    result[name.slice(2)] = value
  }
  if (!result.manifest || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(result.version ?? '')) {
    throw new Error(usage())
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(result.repository)) {
    throw new Error('invalid GitHub repository')
  }
  return {
    manifestPath: result.manifest,
    version: result.version,
    repository: result.repository,
  }
}

function usage() {
  return 'Usage: verify-public-cli-channels.mjs --manifest <path> --version <version> [--repository <owner/repo>]'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const receipt = await verifyPublicCliChannels(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(receipt)}\n`)
  } catch (error) {
    process.stderr.write(`verify public CLI channels: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
