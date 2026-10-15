/** The current machine's Supervisor owns one Default, independent of backends. */
import { resolveSupervisorRootPath, type ResolveSupervisorRootOptions } from './launch-context.ts'
import { readSupervisorConfig, updateSupervisorDefault, parseDefaultTarget } from './supervisor-config.ts'

export interface StartupTarget { machine: string; project: string }
export interface StartupTargetOptions extends ResolveSupervisorRootOptions { supervisorRoot?: string; legacyDesktopPreferencePath?: string; readDefault?: () => Promise<StartupTarget | null>; current?: () => boolean }
export function validateStartupTarget(value: unknown): StartupTarget {
  const target = parseDefaultTarget(value)
  if (!target) throw new Error('Choose a registered Machine and AliceProject.')
  return target
}
export async function readStartupTarget(options: StartupTargetOptions = {}): Promise<StartupTarget | null> {
  const config = await readSupervisorConfig(options.supervisorRoot ?? resolveSupervisorRootPath(options), options)
  if (config.defaultTargetMigrationError) throw new Error(config.defaultTargetMigrationError)
  return config.defaultTarget ?? null
}
export async function writeStartupTarget(target: StartupTarget | null, options: StartupTargetOptions = {}): Promise<void> {
  await updateSupervisorDefault(options.supervisorRoot ?? resolveSupervisorRootPath(options), target, options.current)
}

/** An explicit selection owns a generation through verification and commit. */
export class DefaultSelection {
  private generation = 0
  begin(): { current: () => boolean; cancel: () => void } {
    const generation = ++this.generation
    return { current: () => generation === this.generation, cancel: () => { if (generation === this.generation) this.generation++ } }
  }
  cancel(): void { this.generation++ }
}

/** Resolve on the origin machine. Overrides never ask a remote backend for its Default. */
export async function resolveStartupTarget(input: { machine?: string; project?: string; home?: string; env?: NodeJS.ProcessEnv } = {}, options: StartupTargetOptions = {}): Promise<{ target: StartupTarget | null; override: boolean }> {
  const env = input.env ?? process.env
  const project = input.project ?? env.OPENALICE_PROJECT ?? env.OPENALICE_INSTANCE
  const home = input.home ?? env.OPENALICE_HOME
  if (input.machine && !project) throw new Error('--machine requires an explicit --project.')
  if (project || home) return { target: validateStartupTarget({ machine: input.machine ?? 'local', project: project ?? 'default' }), override: true }
  return { target: await (options.readDefault ?? (() => readStartupTarget(options)))(), override: false }
}
