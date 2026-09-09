import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const paths = vi.hoisted(() => ({ root: '' }))
vi.mock('../core/paths.js', () => ({ defaultPath: (...parts: string[]) => join(paths.root, ...parts) }))
import { aliceHarnessSourceVersion, injectAliceHarnessSkills } from './alice-harness-assets.js'
import { ALICE_HARNESS_SKILLS } from './alice-harness-policy.js'
import { CLI_EXPORTS } from '../server/cli-commands.js'
import { readFile } from 'node:fs/promises'
beforeEach(async () => {
  paths.root = await mkdtemp(join(tmpdir(), 'skill-bundle-'))
  await writeFile(join(paths.root, 'alice-harness.json'), JSON.stringify({ version: '1.0.0' }))
  for (const skill of ALICE_HARNESS_SKILLS) {
    await mkdir(join(paths.root, 'skills', skill), { recursive: true })
    await writeFile(join(paths.root, 'skills', skill, 'SKILL.md'), `# ${skill}`)
  }
})
afterEach(async () => { await rm(paths.root, { recursive: true, force: true }) })
it('versions file content independently of the CLI registry', async () => {
  const before = await aliceHarnessSourceVersion()
  const commands = CLI_EXPORTS.data.commands as Record<string, Record<string, string>>
  commands.testOnly = { changed: 'runtimeOnly' }
  try { expect(await aliceHarnessSourceVersion()).toBe(before) }
  finally { delete commands.testOnly }
  await writeFile(join(paths.root, 'skills/alice/SKILL.md'), 'changed manual')
  expect(await aliceHarnessSourceVersion()).not.toBe(before)
})
it('keeps CLI switches separate from Skill inclusion and creates both runtime copies', async () => {
  const dir = join(paths.root, 'workspace')
  await injectAliceHarnessSkills(dir, true, { schemaVersion: 1, cli: { alice: { enabled: false } }, skills: { traderhub: false } })
  expect(await readFile(join(dir, '.agents/skills/alice/SKILL.md'), 'utf8')).toBe('# alice')
  expect(await readFile(join(dir, '.claude/skills/alice/SKILL.md'), 'utf8')).toBe('# alice')
  await expect(readFile(join(dir, '.agents/skills/traderhub/SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' })
})
