import { appendFileSync, copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCandidateIdentity, verifyCandidateIdentity, createCandidateAcceptance, verifyCandidateAcceptance } from './release-candidate-identity.mjs'

export const DESKTOP_UPGRADE_CHECKS = Object.freeze([
  'previousVersionMatched', 'previousWorkspaceSeeded', 'candidateVersionMatched',
  'previousWorkspacePreserved', 'previousMetadataPreserved', 'browserStatePreserved',
  'postUpgradeWriteSucceeded', 'candidateRestarted', 'restartPreservedPreviousWorkspace',
  'restartPreservedPostUpgradeWrite', 'restartPreservedBrowserState',
])
export const DESKTOP_CANDIDATE_MANIFEST = 'candidate-manifest.json'
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

export function recordDesktopCandidate({ directory, header }) {
  const filenames = readdirSync(directory).filter((name) => /\.(?:dmg|zip|yml|blockmap|exe)$/.test(name))
  const manifest = createCandidateIdentity({ directory, filenames, ...header, kind: 'desktop' })
  writeFileSync(join(directory, DESKTOP_CANDIDATE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export function verifyDesktopCandidate({ directory, expected }) {
  const manifest = readJson(join(directory, DESKTOP_CANDIDATE_MANIFEST))
  verifyCandidateIdentity({ directory, manifest, expected: { ...expected, kind: 'desktop' }, ignoredFiles: [DESKTOP_CANDIDATE_MANIFEST] })
  return manifest
}

export function bindDesktopUpgrade({ directory, expected, verifierSha, previousTag, rawReceipt }) {
  const manifest = verifyDesktopCandidate({ directory, expected })
  if (!/^v\d+\.\d+\.\d+$/.test(previousTag ?? '')
    || rawReceipt?.schemaVersion !== 1 || rawReceipt.mode !== 'desktop-n-1-upgrade'
    || rawReceipt.candidateSource !== 'final-artifact'
    || rawReceipt.fromTag !== previousTag || rawReceipt.previousVersion !== previousTag.slice(1)
    || rawReceipt.candidateVersion !== manifest.version
    || rawReceipt.platform !== manifest.platform || rawReceipt.arch !== manifest.arch) {
    throw new Error('Desktop upgrade receipt does not match candidate or previous release')
  }
  const receipt = {
    ...createCandidateAcceptance({ candidateId: manifest.candidateId, verifierSha,
      checkKind: 'desktop-upgrade', checks: rawReceipt.checks }),
    previousTag,
  }
  verifyCandidateAcceptance({ receipt, candidateId: manifest.candidateId, verifierSha,
    checkKind: 'desktop-upgrade', requiredChecks: DESKTOP_UPGRADE_CHECKS })
  return receipt
}

export function stageDesktopCandidates({ inputDirectory, receiptsDirectory, outputDirectory,
  sourceSha, verifierSha, version, channel, previousTag }) {
  const files = []
  const names = new Set()
  for (const [runner, platform, arch] of [['macOS', 'darwin', 'arm64'], ['macOS', 'darwin', 'x64'], ['Windows', 'win32', 'x64']]) {
    const directory = join(inputDirectory, `release-assets-${runner}-${arch}`)
    // These manifests are downloaded from the selected workflow's build jobs,
    // not supplied by arbitrary external callers. Pin product identity again.
    const identity = readJson(join(directory, DESKTOP_CANDIDATE_MANIFEST))
    const manifest = verifyDesktopCandidate({ directory,
      expected: { sourceSha, version, channel, platform, arch, candidateId: identity.candidateId } })
    if (channel === 'stable') {
      const receipt = readJson(join(receiptsDirectory, `release-upgrade-acceptance-${runner}-${arch}`, 'openalice-desktop-upgrade.json'))
      if (!previousTag || receipt.previousTag !== previousTag) throw new Error('Previous release acceptance mismatch')
      verifyCandidateAcceptance({ receipt, candidateId: manifest.candidateId, verifierSha,
        checkKind: 'desktop-upgrade', requiredChecks: DESKTOP_UPGRADE_CHECKS })
    }
    for (const { name } of manifest.files) {
      if (names.has(name)) throw new Error(`Conflicting desktop asset: ${name}`)
      names.add(name)
      files.push({ name, path: join(directory, name) })
    }
  }
  // Nothing is staged until the complete platform and acceptance set verifies.
  mkdirSync(outputDirectory)
  for (const file of files) copyFileSync(file.path, join(outputDirectory, file.name))
  return files.map(({ name }) => name)
}

function run(argv) {
  if (argv[0] === 'stage' && argv.length === 4) {
    stageDesktopCandidates({ inputDirectory: resolve(argv[1]), receiptsDirectory: resolve(argv[2]),
      outputDirectory: resolve(argv[3]), sourceSha: process.env.CANDIDATE_SOURCE_SHA,
      verifierSha: process.env.CANDIDATE_VERIFIER_SHA || process.env.GITHUB_SHA, version: process.env.CANDIDATE_VERSION,
      channel: process.env.CANDIDATE_CHANNEL, previousTag: process.env.CANDIDATE_PREVIOUS_TAG })
    return
  }
  const [operation, directoryArg, receiptPath] = argv
  if (!['create', 'verify', 'verify-selected', 'bind-upgrade'].includes(operation) || !directoryArg
    || argv.length > 3 || (operation === 'bind-upgrade' && !receiptPath)) {
    throw new Error('Usage: desktop-candidate-receipt.mjs create|verify|bind-upgrade <directory> [receipt]')
  }
  const directory = resolve(directoryArg)
  const platform = { macOS: 'darwin', Windows: 'win32', Linux: 'linux' }[process.env.RUNNER_OS] ?? process.platform
  const header = { sourceSha: process.env.CANDIDATE_SOURCE_SHA,
    version: process.env.CANDIDATE_VERSION || readJson('package.json').version,
    channel: process.env.CANDIDATE_CHANNEL, platform,
    arch: process.env.CANDIDATE_ARCH, kind: 'desktop' }
  if (operation === 'create') {
    const manifest = recordDesktopCandidate({ directory, header })
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `candidate-id=${manifest.candidateId}\n`)
    console.log(`Candidate recorded: ${manifest.candidateId}`)
  } else {
    // Only for an artifact already selected by authenticated GitHub run/id.
    const selectedId = operation === 'verify-selected'
      ? readJson(join(directory, DESKTOP_CANDIDATE_MANIFEST)).candidateId : process.env.CANDIDATE_ID
    const expected = { ...header, candidateId: selectedId }
    if (operation === 'verify' || operation === 'verify-selected') {
      verifyDesktopCandidate({ directory, expected })
      if (operation === 'verify-selected' && process.env.GITHUB_ENV) {
        appendFileSync(process.env.GITHUB_ENV, `CANDIDATE_ID=${selectedId}\n`)
      }
      if (operation === 'verify-selected' && process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `candidate-id=${selectedId}\n`)
      }
    }
    else {
      const receipt = bindDesktopUpgrade({ directory, expected,
        verifierSha: process.env.CANDIDATE_VERIFIER_SHA || process.env.GITHUB_SHA, previousTag: process.env.CANDIDATE_PREVIOUS_TAG,
        rawReceipt: readJson(receiptPath) })
      writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { run(process.argv.slice(2)) } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
