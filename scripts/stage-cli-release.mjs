import { copyFileSync, lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CLI_RELEASE_TARGETS } from '../packages/cli/src/release-targets.mjs'
import { verifyCliReleaseArchive } from './verify-cli-release.mjs'
import { downloadArtifact, latestArtifact, listRunArtifacts, recordSelection } from './release-artifacts.mjs'

export function selectCliArtifacts({ artifacts, runId, sourceSha, now }) {
  if (!Number.isSafeInteger(runId) || runId <= 0 || !/^[a-f0-9]{40}$/.test(sourceSha ?? '')) throw new Error('Invalid CLI source/run')
  const names = CLI_RELEASE_TARGETS.map(([platform, arch]) => `cli-release-${platform}-${arch}`)
  if (artifacts.some(a => a.name.startsWith('cli-release-') && !names.includes(a.name))) throw new Error('Unexpected CLI artifact name; requires fixed per-target names')
  const selected = names.map(name => {
    const artifact = latestArtifact(artifacts, name, now)
    if (artifact.workflow_run?.id !== runId || artifact.workflow_run.head_sha !== sourceSha) throw new Error(`CLI artifact source/run mismatch: ${name}`)
    return artifact
  })
  if (new Set(selected.map(a => a.id)).size !== names.length) throw new Error('Duplicate CLI artifact IDs')
  return selected
}

export function stageCliRelease({ inputDir, outputDir, version, sourceSha }) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version ?? '') || !/^[a-f0-9]{40}$/.test(sourceSha ?? '')) throw new Error('Invalid CLI version/source')
  const targets = CLI_RELEASE_TARGETS.map(([platform, arch]) => ({ platform, arch, name: `cli-release-${platform}-${arch}` }))
  const directories = readdirSync(inputDir).sort()
  if (JSON.stringify(directories) !== JSON.stringify(targets.map(t => t.name).sort())) throw new Error('Expected exactly six isolated CLI targets')
  const files = []
  for (const { platform, arch, name } of targets) {
    const directory = join(inputDir, name)
    if (!lstatSync(directory).isDirectory()) throw new Error(`Invalid CLI target directory: ${name}`)
    const archive = `openalice-cli-${version}-${platform}-${arch}.tar.gz`
    const entries = readdirSync(directory)
    if (entries.some(file => !lstatSync(join(directory, file)).isFile())) throw new Error(`Unexpected nested or linked CLI payload: ${name}`)
    const payloads = entries.filter(n => n.endsWith('.tar.gz') || n.endsWith('.sha256')).sort()
    if (JSON.stringify(payloads) !== JSON.stringify([archive, `${archive}.sha256`])) throw new Error(`Missing or duplicate CLI payload: ${name}`)
    const { metadata } = verifyCliReleaseArchive({ archivePath: join(directory, archive), version, platform, arch })
    // Older POSIX manifests rely on the authenticated Actions run's source;
    // Windows already embeds it, which must agree when present.
    if (metadata.sourceCommit !== undefined && metadata.sourceCommit !== sourceSha || metadata.sourceDirty === true) throw new Error(`CLI manifest source mismatch: ${name}`)
    files.push(...payloads.map(file => ({ source: join(directory, file), name: file })))
  }
  // No publication directory exists until the complete set has passed.
  mkdirSync(outputDir, { recursive: false })
  for (const file of files) copyFileSync(file.source, join(outputDir, file.name))
  return files.map(file => file.name)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [inputDir, outputDir, version, sourceSha] = process.argv.slice(2)
  if (process.argv.length !== 6) throw new Error('Usage: stage-cli-release.mjs <new-input-dir> <new-output-dir> <version> <source-sha>')
  const repository = process.env.GITHUB_REPOSITORY
  const runId = Number(process.env.GITHUB_RUN_ID)
  const selected = selectCliArtifacts({ artifacts: listRunArtifacts(repository, runId), runId, sourceSha })
  recordSelection({ runId, sourceSha, artifacts: selected.map(({ id, name }) => ({ id, name })) })
  mkdirSync(dirname(inputDir), { recursive: true })
  mkdirSync(inputDir, { recursive: false })
  for (const artifact of selected) downloadArtifact(repository, artifact.id, join(inputDir, artifact.name))
  console.log(JSON.stringify(stageCliRelease({ inputDir, outputDir, version, sourceSha })))
}
