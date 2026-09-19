import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { detectAgentBinary } from './agent-detect.js'
import { resolveLaunchCommand } from './win-command.js'

const execFileAsync = promisify(execFile)
const catalog = z.object({ models: z.array(z.object({
  provider: z.string().min(1), id: z.string().min(1),
  selector: z.string().min(1).optional(), name: z.string().optional(),
})) })

export function parseOmpModels(stdout: string) {
  return catalog.parse(JSON.parse(stdout)).models.map((model) => ({
    id: model.selector ?? `${model.provider}/${model.id}`,
    label: model.name ? `${model.name} (${model.provider})` : model.selector ?? `${model.provider}/${model.id}`,
  }))
}

/** Let OMP resolve its own configured providers, without loading extensions or starting inference. */
export async function listOmpModels(cwd: string) {
  const binary = detectAgentBinary('omp', 'omp')
  if (!binary.installed || !binary.path) throw new Error('Oh My Pi is not installed')
  try {
    const command = resolveLaunchCommand([binary.path, 'models', '--json', '--no-extensions'], { cwd })
    const { stdout } = await execFileAsync(command.argv[0]!, command.argv.slice(1), {
      cwd, windowsHide: true, timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
    })
    return parseOmpModels(stdout)
  } catch {
    // Native CLI stderr may contain credential details; do not return it to clients.
    throw new Error('Could not load Oh My Pi models; check its account configuration and retry')
  }
}
