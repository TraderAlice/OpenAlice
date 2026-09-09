import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { CLI_EXPORTS } from '../server/cli-commands.js'

export const ALICE_HARNESS_CONFIG_PATH = '.alice/alice-harness-config.json'
export const ALICE_HARNESS_VERSION_PATH = '.alice/alice-harness-version.json'
export const ALICE_HARNESS_SKILLS = ['alice', 'alice-analysis', 'alice-uta', 'traderhub', 'self-scheduling'] as const
export const LEGACY_ALICE_HARNESS_SKILLS = [...ALICE_HARNESS_SKILLS, 'alice-workspace']
export const aliceHarnessConfigSchema = z.object({
  schemaVersion: z.literal(1),
  skills: z.partialRecord(z.enum(ALICE_HARNESS_SKILLS), z.boolean()).optional(),
  cli: z.record(z.string(), z.object({
    enabled: z.boolean().optional(),
    groups: z.record(z.string(), z.boolean()).optional(),
  }).strict()).default({}),
}).strict()
export type AliceHarnessConfig = z.infer<typeof aliceHarnessConfigSchema>
export const DEFAULT_ALICE_HARNESS_CONFIG: AliceHarnessConfig = { schemaVersion: 1, cli: {} }

export function parseAliceHarnessConfig(value: unknown): AliceHarnessConfig {
  const config = aliceHarnessConfigSchema.parse(value)
  for (const [binary, policy] of Object.entries(config.cli)) {
    const exp = Object.values(CLI_EXPORTS).find((candidate) => candidate.binary === binary && binary !== 'alice-workspace')
    if (!exp || Object.keys(policy.groups ?? {}).some((group) => !Object.hasOwn(exp.commands, group))) throw new Error(`Unknown CLI or command group in ${binary}`)
  }
  return config
}
export async function readAliceHarnessConfig(dir: string): Promise<AliceHarnessConfig> {
  try {
    return parseAliceHarnessConfig(JSON.parse(await readFile(join(dir, ALICE_HARNESS_CONFIG_PATH), 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_ALICE_HARNESS_CONFIG
    throw new Error('Invalid .alice/alice-harness-config.json; fix the configuration before using Workspace CLI commands', { cause: error })
  }
}
export function cliGroupEnabled(config: AliceHarnessConfig, binary: string, group: string): boolean {
  const canonical = binary === 'alice-workspace' ? 'alice' : binary
  const policy = config.cli[canonical]
  return policy?.enabled !== false && policy?.groups?.[group] !== false
}
export function isAliceHarnessSkillPath(path: string): boolean {
  const parts = path.replaceAll('\\', '/').split('/')
  return ['.agents', '.claude', '.pi'].includes(parts[0]) && parts[1] === 'skills'
    && LEGACY_ALICE_HARNESS_SKILLS.includes(parts[2] as typeof LEGACY_ALICE_HARNESS_SKILLS[number])
}
