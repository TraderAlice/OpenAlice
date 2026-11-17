/**
 * Materialize an embedded AutoQuant V2 quantitative research desk as an
 * OpenAlice Workspace.
 *
 * Copies the solidified AutoQuant V2 source tree from `templates/auto-quant-v2/files`
 * (or an explicit `AQ_TEMPLATE_DIR` override), materializes AutoQuant's
 * canonical `workspace_skills` into `.agents/skills/` and `.claude/skills/`
 * alongside a verified `autoquant-skills.json` manifest, and initializes a
 * clean local Git repository on `research/<tag>` without requiring network
 * access or an external mirror.
 *
 * Dependency installation is intentionally absent: the Coding Agent inside the
 * desk owns `uv sync --frozen` and every subsequent research or workbench edit.
 */

import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git, initWorkspaceDir, setupGitExcludes } from '../_common.mjs'

const tag = process.argv[2]
const outDir = process.argv[3]
if (!tag || !outDir) {
  console.error('usage: bootstrap.mjs <tag> <outDir>')
  process.exit(1)
}

const templateRoot = process.env.AQ_TEMPLATE_ROOT
  || dirname(fileURLToPath(import.meta.url))
const overrideDir = process.env.AQ_TEMPLATE_DIR
const filesDir = overrideDir && existsSync(overrideDir)
  ? overrideDir
  : process.env.AQ_TEMPLATE_FILES_DIR || join(templateRoot, 'files')

if (!existsSync(filesDir)) {
  console.error(`AutoQuant template files directory is missing: ${filesDir}`)
  process.exit(3)
}

initWorkspaceDir(outDir)

const IGNORED_NAMES = new Set([
  '.git',
  '.venv',
  '__pycache__',
  '.pytest_cache',
])

cpSync(filesDir, outDir, {
  recursive: true,
  filter(src) {
    const base = src.split(sep).at(-1) ?? ''
    if (IGNORED_NAMES.has(base) || base.endsWith('.pyc')) return false
    return true
  },
})

mkdirSync(join(outDir, 'projects'), { recursive: true })
if (!existsSync(join(outDir, 'projects', '.gitkeep'))) {
  writeFileSync(join(outDir, 'projects', '.gitkeep'), '')
}

materializeAutoQuantSkills(outDir)

await git(['init', '-q', '-b', `research/${tag}`], outDir)
setupGitExcludes(outDir)

console.log(`bootstrapped embedded AutoQuant V2 workspace '${tag}' at ${outDir}`)

function compareCodepoints(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function comparePosixPaths(a, b) {
  const pa = a.split('/')
  const pb = b.split('/')
  const len = Math.min(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const cmp = compareCodepoints(pa[i], pb[i])
    if (cmp !== 0) return cmp
  }
  return pa.length - pb.length
}

function walkSkillFiles(skillRoot) {
  const collected = []
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(full)
      } else if (entry.isFile()) {
        const rel = relative(skillRoot, full).split(sep).join(posix.sep)
        collected.push({ full, rel })
      }
    }
  }
  visit(skillRoot)
  collected.sort((a, b) => comparePosixPaths(a.rel, b.rel))
  return collected.map(({ full, rel }) => ({
    path: rel,
    sha256: createHash('sha256').update(readFileSync(full)).digest('hex'),
  }))
}

function readHarnessVersion(workspaceRoot) {
  const pyprojectPath = join(workspaceRoot, 'pyproject.toml')
  if (existsSync(pyprojectPath)) {
    const match = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(pyprojectPath, 'utf8'))
    if (match?.[1]) return match[1]
  }
  const harnessPath = join(workspaceRoot, 'harness.json')
  if (existsSync(harnessPath)) {
    try {
      const parsed = JSON.parse(readFileSync(harnessPath, 'utf8'))
      if (typeof parsed.version === 'string') return parsed.version
    } catch {
      // ignore
    }
  }
  return '1.0.0'
}

function materializeAutoQuantSkills(workspaceRoot) {
  const sourceRoot = join(workspaceRoot, 'autoquant', 'workspace_skills')
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) return
  const manifestPath = join(workspaceRoot, 'autoquant-skills.json')
  if (existsSync(manifestPath)) return

  const skillDirs = readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort(compareCodepoints)

  if (skillDirs.length === 0) return

  const skills = skillDirs.map((id) => ({
    files: walkSkillFiles(join(sourceRoot, id)),
    id,
  }))

  const discoveryRoots = ['.agents/skills', '.claude/skills']
  for (const discoveryRoot of discoveryRoots) {
    for (const skill of skills) {
      const dest = join(workspaceRoot, discoveryRoot, skill.id)
      mkdirSync(dirname(dest), { recursive: true })
      cpSync(join(sourceRoot, skill.id), dest, {
        recursive: true,
        filter(src) {
          const base = src.split(sep).at(-1) ?? ''
          return base !== '__pycache__' && !base.endsWith('.pyc')
        },
      })
    }
  }

  const canonical = Buffer.from(JSON.stringify(skills), 'utf8')
  const manifest = {
    bundleSha256: createHash('sha256').update(canonical).digest('hex'),
    discoveryRoots,
    harnessVersion: readHarnessVersion(workspaceRoot),
    kind: 'autoquant-workspace-skill-bundle',
    schemaVersion: 1,
    skills,
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}
