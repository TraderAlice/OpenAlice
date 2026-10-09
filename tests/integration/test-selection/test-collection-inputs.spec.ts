import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import vitestConfig from '../../../vitest.config.js'
import { collectionWideTestInputs } from '../../../scripts/test-collection-inputs.mjs'

const root = resolve(import.meta.dirname, '../../..')
it('shares collection metadata triggers across every runnable config', () => {
  expect(vitestConfig.test?.forceRerunTriggers).toEqual(collectionWideTestInputs(root))
  for (const config of ['vitest.config.ts', 'vitest.integration.config.ts', 'vitest.external.config.ts', 'vitest.uta-live.config.ts']) {
    expect(readFileSync(resolve(root, config), 'utf8')).toContain('forceRerunTriggers: collectionWideTestInputs(')
  }
})

it('collects otherwise unrelated tests for metadata-only --changed edits', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'oa-metadata-changed-'))
  try {
    mkdirSync(join(fixture, 'tests'), { recursive: true })
    mkdirSync(join(fixture, 'scripts'), { recursive: true })
    writeFileSync(join(fixture, 'fixture.spec.ts'), 'import { it } from ' + JSON.stringify(resolve(root, 'node_modules/vitest/dist/index.js')) + '; it("unrelated", () => {});')
    writeFileSync(join(fixture, 'vitest.config.mjs'), 'export default ' + JSON.stringify({ test: { include: ['fixture.spec.ts'], forceRerunTriggers: collectionWideTestInputs(fixture) } }))
    const metadata = ['package.json', 'tests/suites.json', 'scripts/test-lanes.mjs', 'vitest.integration.config.mjs']
    for (const file of metadata) writeFileSync(join(fixture, file), file.endsWith('.json') ? '{}' : 'export {}')
    const git = (args: string[]) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8' })
    git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'])
    const collect = () => spawnSync(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'list', '--root', fixture, '--config', join(fixture, 'vitest.config.mjs'), '--changed', 'HEAD', '--json'], { cwd: fixture, encoding: 'utf8', timeout: 20_000 })
    const clean = collect()
    expect(clean.status, clean.stderr).toBe(0)
    expect(JSON.parse(clean.stdout)).toEqual([])
    for (const file of metadata) {
      writeFileSync(join(fixture, file), file.endsWith('.json') ? '{"metadata":true}' : 'export const metadata = true')
      const result = collect()
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual([expect.objectContaining({ name: 'unrelated' })])
      git(['checkout', '--', file])
    }
  } finally { rmSync(fixture, { recursive: true, force: true }) }
}, 60_000)
