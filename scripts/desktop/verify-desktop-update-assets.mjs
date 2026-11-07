#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'

export function updateChannelForVersion(version) {
  return version.match(/^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/)?.[1] ?? 'latest'
}

export function updateMetadataName({ platform, arch, version }) {
  const channel = updateChannelForVersion(version)
  if (platform === 'macOS' || platform === 'darwin') {
    if (arch === 'arm64') return `${channel}-mac.yml`
    if (arch === 'x64') return `${channel}-mac-intel.yml`
  }
  if ((platform === 'Windows' || platform === 'win32') && arch === 'x64') {
    return `${channel}.yml`
  }
  throw new Error(`unsupported desktop update assets: ${platform}-${arch}`)
}

function safeAssetName(raw) {
  const withoutQuery = String(raw).split(/[?#]/, 1)[0]
  let decoded
  try {
    decoded = decodeURIComponent(withoutQuery).replaceAll('\\', '/')
  } catch {
    return null
  }
  const name = basename(decoded)
  return name === decoded || decoded === `./${name}` ? name : null
}

export function verifyDesktopUpdateAssets({ outDir, platform, arch, version }) {
  const errors = []
  const metadataName = updateMetadataName({ platform, arch, version })
  const metadataPath = join(outDir, metadataName)
  if (!existsSync(metadataPath)) {
    return {
      ok: false,
      errors: [`[desktop-update-assets] missing metadata ${metadataName}`],
      metadataPath,
      files: [],
    }
  }

  let metadata
  try {
    metadata = parseYaml(readFileSync(metadataPath, 'utf8'))
  } catch (error) {
    return {
      ok: false,
      errors: [`[desktop-update-assets] invalid ${metadataName}: ${error.message}`],
      metadataPath,
      files: [],
    }
  }
  if (metadata?.version !== version) {
    errors.push(
      `[desktop-update-assets] ${metadataName} version ${JSON.stringify(metadata?.version)} != ${version}`,
    )
  }

  const declaredFiles = Array.isArray(metadata?.files) && metadata.files.length > 0
    ? metadata.files
    : metadata?.path
      ? [{ url: metadata.path, sha512: metadata.sha512, size: metadata.filesize }]
      : []
  if (declaredFiles.length === 0) {
    errors.push(`[desktop-update-assets] ${metadataName} does not declare an update file`)
  }

  const checkedFiles = []
  for (const declared of declaredFiles) {
    const fileName = safeAssetName(declared?.url)
    if (!fileName) {
      errors.push(`[desktop-update-assets] unsafe asset path ${JSON.stringify(declared?.url)}`)
      continue
    }
    const filePath = join(outDir, fileName)
    checkedFiles.push(fileName)
    if (!existsSync(filePath)) {
      errors.push(`[desktop-update-assets] missing referenced asset ${fileName}`)
      continue
    }
    const size = statSync(filePath).size
    if (!Number.isFinite(declared?.size) || declared.size !== size) {
      errors.push(
        `[desktop-update-assets] ${fileName} size ${JSON.stringify(declared?.size)} != ${size}`,
      )
    }
    const sha512 = createHash('sha512').update(readFileSync(filePath)).digest('base64')
    if (declared?.sha512 !== sha512) {
      errors.push(`[desktop-update-assets] ${fileName} SHA-512 mismatch`)
    }
    const blockmap = `${filePath}.blockmap`
    if (!existsSync(blockmap) || statSync(blockmap).size === 0) {
      errors.push(`[desktop-update-assets] missing or empty blockmap ${fileName}.blockmap`)
    }
  }

  const primary = safeAssetName(metadata?.path)
  if (!primary || !checkedFiles.includes(primary)) {
    errors.push(`[desktop-update-assets] primary path is not present in files: ${JSON.stringify(metadata?.path)}`)
  }
  return { ok: errors.length === 0, errors, metadataPath, files: checkedFiles }
}

function parseArgs(argv) {
  const values = {}
  const args = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || !value) throw new Error('expected --out-dir, --platform, --arch, and --version')
    values[key.slice(2)] = value
  }
  for (const key of ['out-dir', 'platform', 'arch', 'version']) {
    if (!values[key]) throw new Error(`missing --${key}`)
  }
  return {
    outDir: resolve(values['out-dir']),
    platform: values.platform,
    arch: values.arch,
    version: values.version,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = parseArgs(process.argv.slice(2))
    const result = verifyDesktopUpdateAssets(input)
    if (!result.ok) {
      for (const error of result.errors) console.error(error)
      process.exitCode = 1
    } else {
      console.log(
        `[desktop-update-assets] ${basename(result.metadataPath)} verified: ${result.files.join(', ')}`,
      )
    }
  } catch (error) {
    console.error(`[desktop-update-assets] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
