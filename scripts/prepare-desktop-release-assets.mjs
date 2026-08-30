#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function prereleaseChannel(version) {
  return version.match(/^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/)?.[1] ?? 'latest'
}

function copyIfPresent(outDir, source, targets) {
  const sourcePath = join(outDir, source)
  if (!existsSync(sourcePath)) return false
  for (const target of targets) {
    if (target === source) continue
    copyFileSync(sourcePath, join(outDir, target))
    console.log(`[release-assets] ${source} -> ${target}`)
  }
  return true
}

export function prepareBuildMetadata({ outDir, platform, arch, version }) {
  const normalizedPlatform = platform.toLowerCase()
  const channel = prereleaseChannel(version)

  if (normalizedPlatform === 'macos' || normalizedPlatform === 'darwin') {
    // electron-builder names generic-provider metadata after the configured
    // prerelease channel (for example beta-mac.yml), while stable builds use
    // latest-mac.yml. Do not assume every build starts from the stable name.
    const source = `${channel}-mac.yml`
    if (!existsSync(join(outDir, source))) {
      throw new Error(`[release-assets] missing ${source} for macOS ${arch}`)
    }

    if (arch === 'arm64') {
      copyIfPresent(outDir, source, [`${channel}-mac-arm64.yml`])
      return
    }

    if (arch === 'x64') {
      copyIfPresent(outDir, source, [`${channel}-mac-intel.yml`, `${channel}-intel-mac.yml`])
      // Keep the generic channel metadata owned by the arm64 build. Intel
      // clients request the architecture-specific compatibility alias above,
      // and merged release artifacts must not contain two competing copies.
      rmSync(join(outDir, source), { force: true })
      return
    }

    throw new Error(`[release-assets] unsupported macOS architecture: ${arch}`)
  }

  if (normalizedPlatform === 'windows' || normalizedPlatform === 'win32') {
    if (channel !== 'latest') {
      copyIfPresent(outDir, 'latest.yml', [`${channel}.yml`])
      rmSync(join(outDir, 'latest.yml'), { force: true })
    }
    return
  }

  throw new Error(`[release-assets] unsupported release platform: ${platform}`)
}

function findFirst(names, candidates) {
  return candidates.find((candidate) => names.includes(candidate)) ?? null
}

function copyAlias(outDir, source, alias) {
  if (!source) return null
  if (source !== alias) {
    copyFileSync(join(outDir, source), join(outDir, alias))
    console.log(`[release-assets] ${source} -> ${alias}`)
  }
  return alias
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function prepareMirrorAssets({ outDir, tag, baseUrl, repository }) {
  const version = tag.replace(/^v/, '')
  const channel = prereleaseChannel(version)
  const releaseChannel = channel === 'latest' ? 'stable' : channel
  if (releaseChannel !== 'stable' && releaseChannel !== 'beta') {
    throw new Error(`[release-assets] unsupported release channel: ${releaseChannel}`)
  }
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const names = readdirSync(outDir)
  const macArm64Dmg = findFirst(names, [`OpenAlice-${version}-arm64.dmg`])
  const macArm64Zip = findFirst(names, [`OpenAlice-${version}-arm64-mac.zip`])
  const macX64Dmg = findFirst(names, [`OpenAlice-${version}-x64.dmg`, `OpenAlice-${version}.dmg`])
  const macX64Zip = findFirst(names, [`OpenAlice-${version}-x64-mac.zip`, `OpenAlice-${version}-mac.zip`])
  const windowsX64Exe = findFirst(names, [`OpenAlice.Setup.${version}.exe`])
  const windowsX64Blockmap = findFirst(names, [`OpenAlice.Setup.${version}.exe.blockmap`])
  const installerAsset = findFirst(names, [`OpenAlice-${version}-install`])

  if (releaseChannel === 'stable') {
    copyAlias(outDir, macArm64Dmg, 'mac-arm64.dmg')
    copyAlias(outDir, macArm64Zip, 'mac-arm64.zip')
    copyAlias(outDir, macX64Dmg, 'mac-x64.dmg')
    copyAlias(outDir, macX64Zip, 'mac-x64.zip')
    copyAlias(outDir, windowsX64Exe, 'windows-x64.exe')
  }
  copyAlias(outDir, installerAsset, 'install')
  if (releaseChannel === 'beta') {
    mkdirSync(join(outDir, 'beta'), { recursive: true })
  }

  const windowsMetadata = join(outDir, `${channel === 'latest' ? 'latest' : channel}.yml`)
  const windowsFeedExe = existsSync(windowsMetadata)
    ? parseYamlScalar(readFileSync(windowsMetadata, 'utf8'), 'path')
    : null
  if (windowsFeedExe?.endsWith('.exe')) {
    copyAlias(outDir, windowsX64Exe, windowsFeedExe)
    copyAlias(outDir, windowsX64Blockmap, `${windowsFeedExe}.blockmap`)
  }

  const urlFor = (name) => name ? `${normalizedBaseUrl}/${name}` : null
  const mutableUrlFor = (stableAlias, versionedAsset) => releaseChannel === 'stable'
    ? urlFor(stableAlias)
    : urlFor(versionedAsset)
  const releaseNotesUrl = `https://github.com/${repository}/releases/tag/${tag}`
  const intelFeed = `${channel}-mac-intel.yml`
  const manifest = {
    channel: releaseChannel,
    version,
    publishedAt: new Date().toISOString(),
    releaseNotesUrl,
    feeds: {
      mac: `${normalizedBaseUrl}/${channel}-mac.yml`,
      macArm64: `${normalizedBaseUrl}/${channel}-mac.yml`,
      macIntel: existsSync(join(outDir, intelFeed)) ? `${normalizedBaseUrl}/${intelFeed}` : null,
      windows: `${normalizedBaseUrl}/${channel}.yml`,
    },
    macArm64Dmg: mutableUrlFor(macArm64Dmg && 'mac-arm64.dmg', macArm64Dmg),
    macArm64Zip: mutableUrlFor(macArm64Zip && 'mac-arm64.zip', macArm64Zip),
    macX64Dmg: mutableUrlFor(macX64Dmg && 'mac-x64.dmg', macX64Dmg),
    macX64Zip: mutableUrlFor(macX64Zip && 'mac-x64.zip', macX64Zip),
    windowsX64Exe: mutableUrlFor(windowsX64Exe && 'windows-x64.exe', windowsX64Exe),
    installer: installerAsset ? {
      url: urlFor('install'),
      sha256: sha256File(join(outDir, installerAsset)),
      versionedUrl: urlFor(installerAsset),
    } : null,
    versioned: {
      macArm64Dmg: urlFor(macArm64Dmg),
      macArm64Zip: urlFor(macArm64Zip),
      macX64Dmg: urlFor(macX64Dmg),
      macX64Zip: urlFor(macX64Zip),
      windowsX64Exe: urlFor(windowsX64Exe),
    },
  }

  const manifestPath = releaseChannel === 'stable'
    ? join(outDir, 'manifest.json')
    : join(outDir, 'beta', 'manifest.json')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  rmSync(join(outDir, 'builder-debug.yml'), { force: true })
  return manifest
}

function parseYamlScalar(content, key) {
  const match = content.match(new RegExp(`(?:^|\\n)${key}:\\s*['"]?([^'"\\n]+)['"]?`))
  return match?.[1]?.trim() || null
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const values = {}
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (!key?.startsWith('--') || value == null) throw new Error(`[release-assets] invalid arguments: ${rest.join(' ')}`)
    values[key.slice(2)] = value
  }
  return { command, values }
}

function requireValues(values, keys) {
  for (const key of keys) {
    if (!values[key]) throw new Error(`[release-assets] missing --${key}`)
  }
}

function main() {
  const { command, values } = parseArgs(process.argv.slice(2))
  if (command === 'build') {
    requireValues(values, ['out-dir', 'platform', 'arch', 'version'])
    prepareBuildMetadata({
      outDir: resolve(values['out-dir']),
      platform: values.platform,
      arch: values.arch,
      version: values.version,
    })
    return
  }
  if (command === 'mirror') {
    requireValues(values, ['out-dir', 'tag', 'base-url', 'repository'])
    prepareMirrorAssets({
      outDir: resolve(values['out-dir']),
      tag: values.tag,
      baseUrl: values['base-url'],
      repository: values.repository,
    })
    return
  }
  throw new Error(`[release-assets] expected build or mirror command, got ${basename(command || '') || 'nothing'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
