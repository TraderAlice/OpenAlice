import { execFileSync } from 'node:child_process'
import { appendFileSync, closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Match Actions' latest-by-exact-name semantics across attempts. Select before
// validating: an expired/broken latest upload must never revive an older one.
export function latestArtifact(artifacts, name, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error('Invalid artifact selection time')
  const matches = artifacts.filter(a => a.name === name)
  if (!matches.length) throw new Error(`Missing artifact: ${name}`)
  if (matches.some(a => !Number.isSafeInteger(a.id) || a.id <= 0)
    || new Set(matches.map(a => a.id)).size !== matches.length) throw new Error(`Duplicate or invalid artifact IDs: ${name}`)
  const artifact = matches.sort((a, b) => b.id - a.id)[0]
  if (artifact.expired !== false || !Number.isFinite(Date.parse(artifact.expires_at))
    || Date.parse(artifact.expires_at) <= now) throw new Error(`Latest artifact expired: ${name} (${artifact.id})`)
  return artifact
}

export function githubJson(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }))
}

export function listRunArtifacts(repository, runId) {
  const artifacts = []
  for (let page = 1; ; page++) {
    const response = githubJson(`repos/${repository}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`)
    artifacts.push(...response.artifacts)
    if (artifacts.length === response.total_count) return artifacts
    if (!response.artifacts.length || artifacts.length > response.total_count) throw new Error('Incomplete artifact listing')
  }
}

export function recordSelection(selection) {
  const text = JSON.stringify(selection, null, 2)
  console.log(text)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nSelected release artifact IDs\n\n\`\`\`json\n${text}\n\`\`\`\n`)
}

// Direct REST download avoids download-artifact's latest-name filtering before
// artifact-ids. Each chosen ID has its own ZIP and new extraction directory.
export function downloadArtifact(repository, id, directory) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid artifact download')
  const temporary = mkdtempSync(join(tmpdir(), 'openalice-artifact-'))
  const zip = join(temporary, 'artifact.zip')
  try {
    const fd = openSync(zip, 'wx')
    try {
      try {
        execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${id}/zip`], { stdio: ['ignore', fd, 'pipe'] })
      } catch {
        // gh errors can contain the signed redirect URL; never log that token.
        throw new Error(`Unable to download exact artifact ID ${id}`)
      }
    } finally { closeSync(fd) }
    execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', `
import pathlib, stat, sys, zipfile
archive, destination = sys.argv[1:]
root = pathlib.Path(destination)
with zipfile.ZipFile(archive) as z:
    seen = set()
    entries = z.infolist()
    if not entries: raise ValueError('Empty artifact ZIP')
    for entry in entries:
        name = entry.filename.rstrip('/')
        parts = name.split('/')
        if not name or any(p in ('', '.', '..') for p in parts) or '\\\\' in name or ':' in name or name in seen:
            raise ValueError('Duplicate or unsafe artifact ZIP entry: ' + name)
        seen.add(name)
        mode = entry.external_attr >> 16
        if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ValueError('Non-regular artifact ZIP entry: ' + name)
    root.mkdir(parents=True, exist_ok=False)
    z.extractall(root)
`, zip, resolve(directory)], { stdio: 'inherit' })
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [id, directory] = process.argv.slice(2)
  if (process.argv.length !== 4) throw new Error('Usage: release-artifacts.mjs <artifact-id> <new-directory>')
  recordSelection({ artifactId: Number(id), directory })
  downloadArtifact(process.env.GITHUB_REPOSITORY, Number(id), directory)
}
