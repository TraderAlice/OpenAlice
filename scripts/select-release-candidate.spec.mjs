import { describe, expect, it } from 'vitest'
import { selectReleaseCandidate } from './select-release-candidate.mjs'

function fixture() {
  const sourceSha = 'a'.repeat(40)
  return { runId: 123, sourceSha, target: 'macOS-arm64', now: Date.parse('2026-09-05T00:00:00Z'),
    run: { id: 123, head_sha: sourceSha, head_branch: 'master', event: 'workflow_dispatch',
      status: 'completed', conclusion: 'failure', path: '.github/workflows/release.yml',
      repository: { id: 7, full_name: 'TraderAlice/OpenAlice' },
      head_repository: { full_name: 'TraderAlice/OpenAlice' } },
    artifacts: [{ id: 456, name: 'release-assets-macOS-arm64', expired: false,
      expires_at: '2026-09-08T00:00:00Z', workflow_run: { id: 123, head_sha: sourceSha,
        head_branch: 'master', repository_id: 7, head_repository_id: 7 } }],
  }
}

describe('trusted release candidate selection', () => {
  it('selects preserved bytes even when a later acceptance job failed', () => {
    expect(selectReleaseCandidate(fixture())).toEqual({ runId: 123, sourceSha: 'a'.repeat(40),
      target: 'macOS-arm64', artifactId: 456, artifactName: 'release-assets-macOS-arm64' })
  })
  it.each([
    ['another run', (v) => { v.run.id = 124 }],
    ['another source', (v) => { v.run.head_sha = 'b'.repeat(40) }],
    ['untrusted branch', (v) => { v.run.head_branch = 'feature' }],
    ['fork', (v) => { v.run.head_repository.full_name = 'attacker/OpenAlice' }],
    ['another workflow', (v) => { v.run.path = '.github/workflows/ci.yml' }],
    ['PR event', (v) => { v.run.event = 'pull_request' }],
    ['still running', (v) => { v.run.status = 'in_progress' }],
    ['missing artifact', (v) => { v.artifacts = [] }],
    ['ambiguous artifact', (v) => { v.artifacts.push({ ...v.artifacts[0], id: 457 }) }],
    ['expired flag', (v) => { v.artifacts[0].expired = true }],
    ['expired timestamp', (v) => { v.artifacts[0].expires_at = '2026-09-01T00:00:00Z' }],
    ['artifact source mismatch', (v) => { v.artifacts[0].workflow_run.head_sha = 'b'.repeat(40) }],
    ['artifact fork', (v) => { v.artifacts[0].workflow_run.head_repository_id = 8 }],
  ])('rejects %s', (_name, mutate) => {
    const input = fixture()
    mutate(input)
    expect(() => selectReleaseCandidate(input)).toThrow()
  })
})
