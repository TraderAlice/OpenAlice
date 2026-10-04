import { describe, expect, it } from 'vitest'
import { latestArtifact } from './release-artifacts.mjs'
import { selectCliArtifacts } from './stage-cli-release.mjs'
import { CLI_RELEASE_TARGETS } from '../packages/cli/src/release-targets.mjs'

const sourceSha = 'a'.repeat(40)
const now = Date.parse('2026-10-04T00:00:00Z')
const attempt = offset => CLI_RELEASE_TARGETS.map(([platform, arch], index) => ({
  id: offset + index, name: `cli-release-${platform}-${arch}`, expired: false,
  expires_at: '2026-11-01T00:00:00Z', workflow_run: { id: 123, head_sha: sourceSha },
}))
const select = artifacts => selectCliArtifacts({ artifacts, runId: 123, sourceSha, now })
describe('release retry artifact selection', () => {
  it('selects all latest IDs on a full retry despite expired old attempts', () => {
    const old = attempt(1).map(a => ({ ...a, expired: true }))
    expect(select([...attempt(101), ...old]).map(a => a.id)).toEqual([101, 102, 103, 104, 105, 106])
  })
  it('inherits untouched successes on partial and publisher-only retries', () => {
    const artifacts = [...attempt(1), ...attempt(101).slice(4)]
    expect(select(artifacts).map(a => a.id)).toEqual([1, 2, 3, 4, 105, 106])
    const publisherOnly = structuredClone(artifacts)
    expect(select(publisherOnly).map(a => a.id)).toEqual([1, 2, 3, 4, 105, 106])
  })
  it.each([
    ['missing', a => a.pop()],
    ['duplicate ID across targets', a => { a[1].id = a[0].id }],
    ['duplicate ID', a => a.push({ ...a[0] })],
    ['expired latest', a => a.push({ ...a[0], id: 101, expired: true })],
    ['expired timestamp', a => a.push({ ...a[0], id: 101, expires_at: '2026-01-01' })],
    ['wrong latest source', a => a.push({ ...a[0], id: 101, workflow_run: { id: 123, head_sha: 'b'.repeat(40) } })],
    ['wrong latest run', a => a.push({ ...a[0], id: 101, workflow_run: { id: 124, head_sha: sourceSha } })],
    ['legacy attempt names', a => a.push({ ...a[4], id: 101, name: `${a[4].name}-${sourceSha}-2` })],
  ])('rejects %s without fallback', (_name, mutate) => {
    const artifacts = attempt(1); mutate(artifacts)
    expect(() => select(artifacts)).toThrow()
  })
  it('does not alias similarly prefixed targets', () => {
    expect(() => latestArtifact(attempt(1), 'cli-release-linux', now)).toThrow('Missing artifact')
  })
})
