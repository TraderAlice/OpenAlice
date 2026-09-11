import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultPath } from '../core/paths.js'
import { ALICE_HARNESS_SKILLS, type AliceHarnessConfig, DEFAULT_ALICE_HARNESS_CONFIG } from './alice-harness-policy.js'

/** The Project supplies this revision; it is independent of Workspace template pins. */
export async function aliceHarnessSourceVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(defaultPath('alice-harness.json'), 'utf8')) as { version: string }
  const hash = createHash('sha256')
  async function walk(dir: string, relative: string) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path, `${relative}/${entry.name}`)
      else if (entry.isFile()) hash.update(`${relative}/${entry.name}\0`).update(await readFile(path))
    }
  }
  for (const skill of ALICE_HARNESS_SKILLS) await walk(defaultPath('skills', skill), skill)
  return `${manifest.version}+${hash.digest('hex').slice(0, 16)}`
}

export async function injectAliceHarnessSkills(dir: string, injectTools: boolean, config: AliceHarnessConfig = DEFAULT_ALICE_HARNESS_CONFIG): Promise<void> {
  const skills = ALICE_HARNESS_SKILLS.filter((skill) => {
    return config.skills?.[skill] ?? (injectTools || skill === 'self-scheduling')
  })
  for (const root of ['.agents/skills', '.claude/skills']) {
    await mkdir(join(dir, root), { recursive: true })
    for (const skill of skills) await cp(defaultPath('skills', skill), join(dir, root, skill), { recursive: true })
  }
}

/** Project-owned source files, never Workspace copies. */
export async function aliceHarnessSkillCatalog() {
  return Promise.all(ALICE_HARNESS_SKILLS.map(async (name) => {
    const files: { path: string; content: string }[] = []
    async function walk(relative: string) {
      const dir = defaultPath('skills', name, relative)
      for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = relative ? `${relative}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(path)
        else if (entry.isFile()) files.push({ path, content: await readFile(join(dir, entry.name), 'utf8') })
      }
    }
    await walk('')
    return { name, files }
  }))
}
