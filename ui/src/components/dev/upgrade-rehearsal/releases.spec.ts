import { expect, it } from 'vitest'
import {
  initialPublication,
  createRelease,
  advanceRelease,
  head,
  releaseAssets,
} from './releases'
import { initial, reduce, consumed } from './model'
it('requires verified publication before moving a channel head', async () => {
  let p = createRelease(initialPublication(), 'beta')
  const id = p.records.at(-1)!.id
  expect(head(p, 'beta')).toBeNull()
  p = advanceRelease(advanceRelease(p, id), id)
  expect(head(p, 'beta')).toBeNull()
  p = advanceRelease(p, id)
  expect(head(p, 'beta')?.version).toBe('0.94.2-beta.1')
  expect(head(p, 'stable')?.version).toBe('0.94.1')
  expect(releaseAssets(head(p, 'beta')!)).toHaveLength(61)
})
it('locks approved artifacts while newer versions are published', async () => {
  let s = await reduce(initial(), { type: 'publish', value: 'stable' })
  let id = s.publication.records.at(-1)!.id
  for (let i = 0; i < 3; i++) s = await reduce(s, { type: 'advance', value: id })
  s = await reduce(await reduce(await reduce(s, { type: 'discover' }), { type: 'review' }), {
    type: 'approve',
  })
  const artifacts = consumed(s)
  s = await reduce(s, { type: 'publish', value: 'stable' })
  id = s.publication.records.at(-1)!.id
  for (let i = 0; i < 3; i++) s = await reduce(s, { type: 'advance', value: id })
  s = await reduce(s, { type: 'discover' })
  expect(s.target).toBe('0.94.2')
  expect(consumed(s)).toEqual(artifacts)
  expect(head(s.publication, 'stable')?.version).toBe('0.94.3')
})

it('models current dev CLI and broker artifacts without desktop/package-manager assets', async () => {
  const p=createRelease(initialPublication(),'dev')
  const release=p.records.at(-1)!
  const assets=releaseAssets(release)
  expect(release.commit).toHaveLength(40)
  expect(assets).toHaveLength(49)
  expect(assets.every(a=>a.startsWith(`cli/dev/releases/${release.commit}/`))).toBe(true)
  expect(assets.filter(a=>a.includes('Broker-Packs-'))).toHaveLength(6)
  expect(assets.some(a=>a.endsWith('longbridge-0.94.1-win32-arm64.tgz'))).toBe(false)
})
