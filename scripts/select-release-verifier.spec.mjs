import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { selectReleaseVerifier } from './select-release-verifier.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
it('pins product source while allowing only integrated verifier commits', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'release-verifier-'))
  roots.push(cwd)
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Verifier fixture')
  git('config', 'user.email', 'fixture@example.invalid')
  git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'product')
  const sourceSha = git('rev-parse', 'HEAD')
  expect(selectReleaseVerifier({ cwd, sourceSha })).toBe(sourceSha)
  git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'verifier fix')
  const requestedSha = git('rev-parse', 'HEAD')
  expect(() => selectReleaseVerifier({ cwd, sourceSha, requestedSha })).toThrow('integrated')
  git('update-ref', 'refs/remotes/origin/dev', requestedSha)
  expect(selectReleaseVerifier({ cwd, sourceSha, requestedSha })).toBe(requestedSha)
  expect(git('rev-parse', `${sourceSha}^{commit}`)).toBe(sourceSha)
  expect(() => selectReleaseVerifier({ cwd, sourceSha, requestedSha: 'dev' })).toThrow('full commit')
  expect(() => selectReleaseVerifier({ cwd, sourceSha, requestedSha: 'f'.repeat(40) })).toThrow()
})
