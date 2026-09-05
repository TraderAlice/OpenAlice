import { execFile } from 'node:child_process'
import { exec as bundledExec } from 'dugite'
import type {
  IGitExecutionOptions, IGitStringExecutionOptions, IGitBufferExecutionOptions,
  IGitResult, IGitStringResult, IGitBufferResult,
} from 'dugite'

export type { IGitStringExecutionOptions } from 'dugite'

export function exec(args: string[], cwd: string, options?: IGitStringExecutionOptions): Promise<IGitStringResult>
export function exec(args: string[], cwd: string, options: IGitBufferExecutionOptions): Promise<IGitBufferResult>
export function exec(args: string[], cwd: string, options?: IGitExecutionOptions): Promise<IGitResult>
export function exec(args: string[], cwd: string, options?: IGitExecutionOptions): Promise<IGitResult> {
  if (!(globalThis as { __OPENALICE_BUN_STANDALONE__?: boolean }).__OPENALICE_BUN_STANDALONE__) {
    return bundledExec(args, cwd, options)
  }
  return execSystemGit(args, cwd, options)
}

/** Keep system Git's own prefix, templates, config and certificate discovery. */
export function execSystemGit(args: string[], cwd: string, options: IGitExecutionOptions = {}): Promise<IGitResult> {
  const env = { ...process.env, ...options.env }
  const executable = env.OPENALICE_SYSTEM_GIT_PATH || 'git'
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, {
      cwd, env, shell: false, windowsHide: true,
      encoding: options.encoding === 'buffer' ? null : options.encoding ?? 'utf8',
      maxBuffer: options.maxBuffer ?? Infinity,
      signal: options.signal, killSignal: options.killSignal,
    }, (error, stdout, stderr) => {
      if (!error || typeof error.code === 'number') {
        resolve({ stdout, stderr, exitCode: typeof error?.code === 'number' ? error.code : 0 })
      } else reject(Object.assign(error, { stdout, stderr }))
    })
    child.stdin?.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') reject(error)
    })
    if (options.stdin !== undefined) {
      if (options.stdinEncoding) child.stdin?.end(options.stdin, options.stdinEncoding)
      else child.stdin?.end(options.stdin)
    }
    options.processCallback?.(child)
  })
}
