import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join, parse, resolve } from 'node:path'

import {
  CLI_RELEASE_TARGETS,
  validateCliReleaseArchive,
} from './prepare-cli-dev-assets.mjs'
import { bunReleaseContentIdentity } from './bun-release-content-identity.mjs'

export function preparePreviousCliReleaseArchives({ inputDir, outputDir, version }) {
  const inputRoot = resolve(inputDir)
  const outputRoot = resolve(outputDir)
  assertSafeOutputRoot(outputRoot, inputRoot)
  const previousVersion = syntheticPreviousVersion(version)
  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(outputRoot, { recursive: true })

  const targets = []
  for (const [platform, arch] of CLI_RELEASE_TARGETS) {
    const currentArchive = join(inputRoot, `openalice-cli-${version}-${platform}-${arch}.tar.gz`)
    const current = validateCliReleaseArchive({
      archivePath: currentArchive,
      version,
      platform,
      arch,
    })
    const stagingRoot = mkdtempSync(join(tmpdir(), 'openalice-cli-previous-'))
    try {
      execFileSync('tar', ['-xzf', currentArchive, '-C', stagingRoot])
      const currentReleaseRoot = join(stagingRoot, current.releaseName)
      const rewritten = rewriteExpandedCliRelease({
        releaseRoot: currentReleaseRoot,
        fromVersion: version,
        toVersion: previousVersion,
      })
      const previousName = `openalice-cli-${previousVersion}-${platform}-${arch}`
      const previousReleaseRoot = join(stagingRoot, previousName)
      renameSync(currentReleaseRoot, previousReleaseRoot)
      const previousArchive = join(outputRoot, `${previousName}.tar.gz`)
      execFileSync('tar', ['-czf', previousArchive, '-C', stagingRoot, previousName])
      const checksum = sha256(readFileSync(previousArchive))
      writeFileSync(`${previousArchive}.sha256`, `${checksum}  ${basename(previousArchive)}\n`)
      validateCliReleaseArchive({
        archivePath: previousArchive,
        version: previousVersion,
        platform,
        arch,
      })
      targets.push({
        platform,
        arch,
        currentContentIdentity: current.metadata.contentIdentity,
        previousContentIdentity: rewritten.contentIdentity,
      })
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true })
    }
  }

  const manifest = { schemaVersion: 1, version, previousVersion, targets }
  writeFileSync(join(outputRoot, 'fixture.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export function rewriteExpandedCliRelease({ releaseRoot, fromVersion, toVersion }) {
  const executablePath = join(releaseRoot, 'bin', 'openalice')
  const executable = readFileSync(executablePath)
  const from = Buffer.from(fromVersion)
  const to = Buffer.from(toVersion)
  if (from.length !== to.length) {
    throw new Error('synthetic package-manager versions must have equal byte length')
  }
  let replacements = 0
  for (let offset = executable.indexOf(from); offset >= 0; offset = executable.indexOf(from, offset + to.length)) {
    to.copy(executable, offset)
    replacements += 1
  }
  if (replacements === 0) {
    throw new Error(`native executable did not contain embedded version ${fromVersion}`)
  }
  writeFileSync(executablePath, executable)
  if (process.platform === 'darwin' && isMachO(executable)) {
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', executablePath])
  }
  const rewrittenExecutable = readFileSync(executablePath)
  const executableSha256 = sha256(rewrittenExecutable)

  const resourcePackagePath = join(releaseRoot, 'share', 'openalice', 'package.json')
  const resourcePackage = JSON.parse(readFileSync(resourcePackagePath, 'utf8'))
  resourcePackage.version = toVersion
  writeFileSync(resourcePackagePath, `${JSON.stringify(resourcePackage, null, 2)}\n`)

  const releasePath = join(releaseRoot, 'release.json')
  const release = JSON.parse(readFileSync(releasePath, 'utf8'))
  if (release.version !== fromVersion) {
    throw new Error(`release metadata version is ${release.version}, expected ${fromVersion}`)
  }
  release.version = toVersion
  updateReleaseFile(release, 'bin/openalice', executablePath)
  updateReleaseFile(release, 'share/openalice/package.json', resourcePackagePath)
  const contentIdentity = bunReleaseContentIdentity(release)
  release.contentIdentity = contentIdentity
  writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`)
  return { contentIdentity, executableSha256, replacements }
}

export function syntheticPreviousVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(-beta(?:\.[1-9][0-9]*)?)?$/.exec(version)
  if (!match) throw new Error(`package-manager smoke requires a stable or beta version, got ${version}`)
  const [, majorRaw, minorRaw, patchRaw, prerelease = ''] = match
  const major = Number(majorRaw)
  const minor = Number(minorRaw)
  const patch = Number(patchRaw)
  const candidates = [
    ...(patch > 0 ? [`${majorRaw}.${minorRaw}.${patch - 1}`] : []),
    ...(minor > 0 ? [`${majorRaw}.${minor - 1}.${'9'.repeat(patchRaw.length)}`] : []),
    ...(major > 0 ? [`${major - 1}.${'9'.repeat(minorRaw.length)}.${'9'.repeat(patchRaw.length)}`] : []),
  ]
  const candidate = candidates
    .map((value) => `${value}${prerelease}`)
    .find((value) => value.length === version.length)
  if (candidate) return candidate
  throw new Error(`cannot derive a prior package-manager fixture version from ${version}`)
}

function updateReleaseFile(release, relativePath, sourcePath) {
  const entry = release.files?.find((candidate) => candidate.path === relativePath)
  if (!entry || entry.type !== 'file') throw new Error(`release metadata omitted ${relativePath}`)
  const content = readFileSync(sourcePath)
  entry.bytes = content.length
  entry.sha256 = sha256(content)
}

function isMachO(content) {
  if (content.length < 4) return false
  return new Set(['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca']).has(content.subarray(0, 4).toString('hex'))
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function assertSafeOutputRoot(outputRoot, inputRoot) {
  if (
    outputRoot === parse(outputRoot).root
    || outputRoot === homedir()
    || outputRoot === resolve('.')
    || outputRoot === inputRoot
    || inputRoot.startsWith(`${outputRoot}/`)
  ) {
    throw new Error(`refusing unsafe CLI fixture output directory: ${outputRoot}`)
  }
  if (!existsSync(inputRoot)) throw new Error(`CLI release input directory does not exist: ${inputRoot}`)
}
