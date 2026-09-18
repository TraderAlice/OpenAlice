import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { verifyNativeBootstrapFormat } from './native-bootstrap-format.mjs'

interface NativeBootstrapBuildOptions {
  repositoryRoot: string
  outputRoot: string
  version: string
  platform: 'darwin' | 'linux' | 'win32'
  arch: 'arm64' | 'x64'
  target?: 'bun-darwin-arm64' | 'bun-darwin-x64' | 'bun-linux-arm64' | 'bun-linux-x64' | 'bun-windows-arm64' | 'bun-windows-x64'
}

export async function buildNativeBootstrap(options: NativeBootstrapBuildOptions): Promise<{
  executablePath: string
  sha256Path: string
  sha256: string
  formatVerification: 'passed'
  runtimeVerification: 'passed' | 'not-run-cross-target'
}> {
  const name = `openalice-bootstrap-${options.version}-${options.platform}-${options.arch}${options.platform === 'win32' ? '.exe' : ''}`
  const executablePath = join(options.outputRoot, name)
  await mkdir(options.outputRoot, { recursive: true })
  await rm(executablePath, { force: true })
  await rm(`${executablePath}.sha256`, { force: true })
  const result = await Bun.build({
    entrypoints: [join(options.repositoryRoot, 'packages/cli/bin/openalice-bootstrap.ts')],
    compile: {
      outfile: executablePath,
      ...(options.target ? { target: options.target } : {}),
      autoloadBunfig: false,
      autoloadDotenv: false,
    },
    define: {
      'globalThis.__OPENALICE_BUILD_VERSION__': JSON.stringify(options.version),
      'globalThis.__OPENALICE_BUN_STANDALONE__': 'true',
    },
    minify: true,
  })
  if (!result.success) throw new Error(result.logs.map(String).join('\n'))
  const formatVerification = verifyNativeBootstrapFormat(executablePath, options.platform, options.arch)
  const sha256 = await sha256File(executablePath)
  const sha256Path = `${executablePath}.sha256`
  await writeFile(sha256Path, `${sha256}  ${basename(executablePath)}\n`)
  const runtimeVerification = process.platform === options.platform && process.arch === options.arch
    ? smokeNativeBootstrap(executablePath)
    : 'not-run-cross-target'
  return { executablePath, sha256Path, sha256, formatVerification, runtimeVerification }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function smokeNativeBootstrap(executablePath: string): 'passed' {
  const smoke = Bun.spawnSync([executablePath, '--help'], { stdout: 'pipe', stderr: 'pipe' })
  if (smoke.exitCode !== 0 || !smoke.stdout.toString().includes('OpenAlice Native Bootstrap')) {
    throw new Error(`native bootstrap smoke failed: ${smoke.stderr.toString()}`)
  }
  return 'passed'
}
