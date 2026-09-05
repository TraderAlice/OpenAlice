import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DESKTOP_UPGRADE_CHECKS, recordDesktopCandidate, verifyDesktopCandidate, bindDesktopUpgrade, stageDesktopCandidates } from './desktop-candidate-receipt.mjs'

const roots = []
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture(channel = 'stable') {
  const root = mkdtempSync(join(tmpdir(), 'desktop-candidate-'))
  roots.push(root)
  const options = { inputDirectory: join(root, 'candidates'), receiptsDirectory: join(root, 'receipts'),
    outputDirectory: join(root, 'staged'), sourceSha: 'a'.repeat(40), verifierSha: 'b'.repeat(40),
    version: channel === 'stable' ? '0.91.1' : '0.91.1-beta.1', channel, previousTag: 'v0.91.0' }
  const records = []
  for (const [runner, platform, arch] of [['macOS', 'darwin', 'arm64'], ['macOS', 'darwin', 'x64'], ['Windows', 'win32', 'x64']]) {
    const directory = join(options.inputDirectory, `release-assets-${runner}-${arch}`)
    mkdirSync(directory, { recursive: true })
    const filename = `${platform}-${arch}.zip`
    writeFileSync(join(directory, filename), `candidate for ${platform}-${arch}`)
    const header = { sourceSha: options.sourceSha, version: options.version, channel, platform, arch }
    const manifest = recordDesktopCandidate({ directory, header })
    const expected = { ...header, candidateId: manifest.candidateId }
    const rawReceipt = { schemaVersion: 1, mode: 'desktop-n-1-upgrade', candidateSource: 'final-artifact',
      fromTag: options.previousTag, previousVersion: '0.91.0', candidateVersion: options.version, platform, arch,
      checks: Object.fromEntries(DESKTOP_UPGRADE_CHECKS.map((key) => [key, true])) }
    const receipt = bindDesktopUpgrade({ directory, expected, verifierSha: options.verifierSha,
      previousTag: options.previousTag, rawReceipt })
    const receiptDirectory = join(options.receiptsDirectory, `release-upgrade-acceptance-${runner}-${arch}`)
    mkdirSync(receiptDirectory, { recursive: true })
    const receiptPath = join(receiptDirectory, 'openalice-desktop-upgrade.json')
    writeFileSync(receiptPath, JSON.stringify(receipt))
    records.push({ directory, expected, rawReceipt, receipt, receiptPath, filename })
  }
  return { options, records }
}

describe('desktop candidate acceptance integration', () => {
  it('binds CLI acceptance to a selected verifier while preserving original product identity', () => {
    const { options, records } = fixture()
    const record = records[0]
    const rawPath = join(options.inputDirectory, 'raw-receipt.json')
    writeFileSync(rawPath, JSON.stringify(record.rawReceipt))
    const original = readFileSync(join(record.directory, record.filename))
    execFileSync(process.execPath, [join(import.meta.dirname, 'desktop-candidate-receipt.mjs'),
      'bind-upgrade', record.directory, rawPath], { env: { ...process.env,
      RUNNER_OS: 'macOS', CANDIDATE_ARCH: 'arm64', CANDIDATE_CHANNEL: 'stable',
      GITHUB_SHA: options.sourceSha, CANDIDATE_SOURCE_SHA: options.sourceSha,
      CANDIDATE_VERSION: options.version, CANDIDATE_VERIFIER_SHA: options.verifierSha,
      CANDIDATE_PREVIOUS_TAG: options.previousTag, CANDIDATE_ID: record.expected.candidateId,
    } })
    expect(JSON.parse(readFileSync(rawPath, 'utf8'))).toMatchObject({
      verifierSha: options.verifierSha, candidateId: record.expected.candidateId,
    })
    expect(readFileSync(join(record.directory, record.filename))).toEqual(original)
  })
  it('pins an authenticated selected artifact only after byte and source verification', () => {
    const { options, records } = fixture()
    const record = records[0]
    const output = join(options.inputDirectory, 'github-env')
    const env = { ...process.env, RUNNER_OS: 'macOS', CANDIDATE_ARCH: 'arm64',
      CANDIDATE_SOURCE_SHA: options.sourceSha, CANDIDATE_VERSION: options.version,
      CANDIDATE_CHANNEL: 'stable', GITHUB_ENV: output }
    const args = [join(import.meta.dirname, 'desktop-candidate-receipt.mjs'), 'verify-selected', record.directory]
    execFileSync(process.execPath, args, { env })
    expect(readFileSync(output, 'utf8')).toBe(`CANDIDATE_ID=${record.expected.candidateId}\n`)
    rmSync(output)
    expect(() => execFileSync(process.execPath, args, {
      env: { ...env, CANDIDATE_SOURCE_SHA: 'f'.repeat(40) }, stdio: 'pipe',
    })).toThrow()
    expect(existsSync(output)).toBe(false)
  })
  it('verifies restored packages and stages the entire accepted stable set', () => {
    const { options, records } = fixture()
    expect(verifyDesktopCandidate(records[0]).candidateId).toBe(records[0].expected.candidateId)
    expect(stageDesktopCandidates(options)).toHaveLength(3)
    for (const record of records) expect(readFileSync(join(options.outputDirectory, record.filename), 'utf8'))
      .toBe(readFileSync(join(record.directory, record.filename), 'utf8'))
    expect(existsSync(join(options.outputDirectory, 'candidate-manifest.json'))).toBe(false)
  })
  it.each(['missing', 'bytes', 'verifier', 'previous', 'check', 'identity'])('does not stage any bytes for %s failure', (failure) => {
    const { options, records } = fixture()
    const last = records[2]
    if (failure === 'missing') rmSync(last.receiptPath)
    else if (failure === 'bytes') writeFileSync(join(last.directory, last.filename), 'changed')
    else {
      if (failure === 'verifier') last.receipt.verifierSha = 'c'.repeat(40)
      if (failure === 'previous') last.receipt.previousTag = 'v0.90.2'
      if (failure === 'check') delete last.receipt.checks.candidateRestarted
      if (failure === 'identity') last.receipt.candidateId = 'd'.repeat(64)
      writeFileSync(last.receiptPath, JSON.stringify(last.receipt))
    }
    expect(() => stageDesktopCandidates(options)).toThrow()
    expect(existsSync(options.outputDirectory)).toBe(false)
  })
  it('rejects an upgrade report from an unpacked rather than final artifact', () => {
    const { options, records } = fixture()
    const record = records[0]
    record.rawReceipt.candidateSource = 'package-root'
    expect(() => bindDesktopUpgrade({ ...record, previousTag: options.previousTag, verifierSha: options.verifierSha }))
      .toThrow('does not match')
  })
  it('keeps beta separate from stable N-1 receipts while still verifying all bytes', () => {
    const { options } = fixture('beta')
    rmSync(options.receiptsDirectory, { recursive: true })
    expect(stageDesktopCandidates(options)).toHaveLength(3)
  })
})
