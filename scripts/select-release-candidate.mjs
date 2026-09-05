import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REPOSITORY = 'TraderAlice/OpenAlice'
const TARGETS = new Set(['macOS-arm64', 'macOS-x64', 'Windows-x64'])

// GitHub authenticates the producing run. The downloaded manifest subsequently
// binds this source/target to exact candidate bytes; neither check replaces the other.
export function selectReleaseCandidate({ run, artifacts, runId, sourceSha, target, now = Date.now() }) {
  if (!Number.isSafeInteger(runId) || runId <= 0 || !/^[a-f0-9]{40}$/.test(sourceSha ?? '')
    || !TARGETS.has(target) || !Number.isFinite(now)) throw new Error('Invalid candidate selection')
  if (run?.id !== runId || run.repository?.full_name !== REPOSITORY
    || !Number.isSafeInteger(run.repository?.id) || run.repository.id <= 0
    || run.head_repository?.full_name !== REPOSITORY
    || run.path !== '.github/workflows/release.yml'
    || run.event !== 'workflow_dispatch' || run.head_branch !== 'master'
    || run.head_sha !== sourceSha || run.status !== 'completed'
    || !['success', 'failure', 'cancelled', 'timed_out'].includes(run.conclusion)) {
    throw new Error('Candidate must come from the selected completed master Release run')
  }
  const name = `release-assets-${target}`
  const matches = artifacts.filter((artifact) => artifact.name === name)
  if (matches.length !== 1) throw new Error(`Expected exactly one candidate artifact: ${name}`)
  const artifact = matches[0]
  const expiry = Date.parse(artifact.expires_at)
  if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0 || artifact.expired !== false
    || !Number.isFinite(expiry) || expiry <= now
    || artifact.workflow_run?.id !== runId || artifact.workflow_run.head_sha !== sourceSha
    || artifact.workflow_run.head_branch !== 'master'
    || artifact.workflow_run.repository_id !== run.repository.id
    || artifact.workflow_run.head_repository_id !== run.repository.id) {
    throw new Error('Candidate artifact is expired or belongs to another source/run')
  }
  return { runId, sourceSha, target, artifactId: artifact.id, artifactName: name }
}

function github(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }))
}

export function selectFromGitHub({ runId, sourceSha, target }) {
  const run = github(`repos/${REPOSITORY}/actions/runs/${runId}`)
  const artifacts = []
  for (let page = 1; ; page++) {
    const response = github(`repos/${REPOSITORY}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`)
    artifacts.push(...response.artifacts)
    if (artifacts.length >= response.total_count) break
    if (response.artifacts.length === 0) throw new Error('Incomplete artifact listing')
  }
  return selectReleaseCandidate({ run, artifacts, runId, sourceSha, target })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [id, sourceSha, target] = process.argv.slice(2)
    if (process.argv.length !== 5 || !/^[1-9][0-9]*$/.test(id ?? '')) {
      throw new Error('Usage: select-release-candidate.mjs <run-id> <source-sha> <macOS-arm64|macOS-x64|Windows-x64>')
    }
    const result = selectFromGitHub({ runId: Number(id), sourceSha, target })
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `artifact-id=${result.artifactId}\nsource-sha=${result.sourceSha}\n`)
    }
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
