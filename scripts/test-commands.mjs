import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function readCommandProfiles(root = repoRoot) {
  return JSON.parse(readFileSync(resolve(root, 'tests/commands.json'), 'utf8'))
}

export function isTestCommandName(name) {
  return /(^test($|:)|smoke|verify|assert-package)/.test(name)
}

// Command strings stay authoritative in package.json. This file supplies only
// prerequisites/effects for dedicated runners, never another executable alias.
export function collectTestCommands(root, packages, ownerForRoot) {
  const profiles = readCommandProfiles(root)
  const manifests = [{ name: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).name, root: '.' }, ...packages]
  const commands = manifests.flatMap((workspace) => {
    const scripts = JSON.parse(readFileSync(resolve(root, workspace.root, 'package.json'), 'utf8')).scripts ?? {}
    return Object.entries(scripts).filter(([name]) => isTestCommandName(name)).map(([name, command]) => {
      const id = `${workspace.name}#${name}`
      const profile = profiles.commands[id]
      const owner = workspace.root === '.' ? 'repo-tooling' : ownerForRoot(workspace.root)
      const selector = /(?:^|\s)(?:vitest|vp\s+test|(?:\S*\/)?scripts\/run-tests\.mjs)(?:\s|$)/.test(command)
      const lane = command.match(/--lane\s+(\S+)/)?.[1] ?? 'hermetic'
      return {
        id, name, manifest: `${workspace.root === '.' ? '' : `${workspace.root}/`}package.json`,
        command, invocation: workspace.root === '.' ? `pnpm ${name}` : `pnpm -F ${workspace.name} ${name}`,
        owner, lane, kind: selector ? (/--(?:suites|inventory)(?:\s|$)/.test(command) ? 'inventory' : 'spec-selection') : 'unclassified',
        sideEffects: selector ? 'selected lane; hermetic by default, explicit external/live options retain their guards' : 'unclassified; inspect the dedicated runner before execution',
        prerequisites: selector ? ['workspace dependencies installed; see selected lane prerequisites'] : [],
        ...profile,
        executed: false,
      }
    })
  })
  for (const task of profiles.standalone) {
    commands.push({ ...task, kind: task.kind ?? 'artifact-acceptance', executed: false })
  }
  return commands.sort((left, right) => left.id.localeCompare(right.id))
}

export function validateTestCommands(root, commands, owners, lanes) {
  const profiles = readCommandProfiles(root)
  const kinds = ['spec-selection', 'inventory', 'process-acceptance', 'host-acceptance', 'artifact-acceptance', 'artifact-check']
  const ids = new Set()
  for (const command of commands) {
    if (ids.has(command.id)) throw new Error(`Duplicate command ${command.id}`)
    ids.add(command.id)
    if (!owners.includes(command.owner) || !lanes.includes(command.lane)) throw new Error(`Invalid command owner/lane: ${command.id}`)
    if (!kinds.includes(command.kind)) throw new Error(`Dedicated command needs a valid profile: ${command.id}`)
    if (!command.sideEffects || !Array.isArray(command.prerequisites) || command.prerequisites.length === 0) throw new Error(`Command needs effects/prerequisites: ${command.id}`)
    if (command.path && (command.path.startsWith('/') || command.path.includes('\\') || command.path.split('/').includes('..') || !existsSync(resolve(root, command.path)))) {
      throw new Error(`Invalid standalone runner: ${command.id}`)
    }
  }
  for (const id of Object.keys(profiles.commands)) {
    if (!ids.has(id)) throw new Error(`Stale command profile: ${id}`)
    if (['id', 'name', 'manifest', 'command', 'invocation', 'executed'].some((field) => field in profiles.commands[id])) {
      throw new Error(`Command profile must not copy/override manifest identity or invocation: ${id}`)
    }
  }
}

const rootScripts = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).scripts
export const systemCommandSuites = Object.fromEntries(
  Object.entries(readCommandProfiles().commands)
    .filter(([id]) => id.startsWith('open-alice#test:system:'))
    .map(([id, profile]) => {
      const name = id.slice('open-alice#test:system:'.length)
      return [name, { ...profile, command: rootScripts[`test:system:${name}`] }]
    }),
)
