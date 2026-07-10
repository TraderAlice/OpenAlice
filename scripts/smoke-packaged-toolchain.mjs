#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertDesktopPackage } from './assert-desktop-package.mjs'

export function buildPackagedToolchainSmokePlan(packageResult) {
  const errors = [...packageResult.errors]
  const commands = []
  if (!packageResult.ok || !packageResult.appRoot || !packageResult.manifest) {
    return { ok: false, errors, commands }
  }

  const electron = packagedElectronExecutable(packageResult.appRoot, packageResult.platform)
  if (!electron || !existsSync(electron)) {
    errors.push(`[packaged-toolchain] packaged Electron executable not found for ${packageResult.platform}`)
    return { ok: false, errors, commands }
  }

  commands.push({
    label: 'packaged Electron Node mode',
    command: electron,
    args: ['-e', 'console.log("OPENALICE_ELECTRON_NODE_OK " + process.versions.node)'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    expectStdout: /OPENALICE_ELECTRON_NODE_OK \d+\.\d+\.\d+/,
  })

  const piCli = join(packageResult.appRoot, packageResult.manifest.pi.cli)
  commands.push({
    label: 'managed Pi through packaged Electron Node',
    command: electron,
    args: [piCli, '--version'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    expectStdout: /\b0\.80\.6\b/,
  })

  if (packageResult.platform === 'win32') {
    const git = packageResult.manifest.git?.[packageResult.platformArch]
    if (!git) {
      errors.push(`[packaged-toolchain] missing Windows managed Git manifest entry ${packageResult.platformArch}`)
      return { ok: false, errors, commands }
    }
    const gitRoot = join(packageResult.appRoot, git.path)
    const gitExe = join(gitRoot, git.gitBin)
    const bashExe = join(gitRoot, git.shellPath)
    const shExe = join(gitRoot, git.shPath)
    const toolchainPath = (Array.isArray(git.toolchainPaths) ? git.toolchainPaths : ['cmd', 'bin', 'usr/bin'])
      .map((entry) => join(gitRoot, entry))
      .join(delimiter)
    const winEnv = {
      PATH: [toolchainPath, process.env['PATH']].filter(Boolean).join(delimiter),
      CHERE_INVOKING: '1',
      MSYSTEM: packageResult.platformArch.endsWith('arm64') ? 'CLANGARM64' : 'MINGW64',
    }

    commands.push({
      label: 'managed git.exe',
      command: gitExe,
      args: ['--version'],
      expectStdout: /^git version /m,
    })
    commands.push({
      label: 'managed bash.exe',
      command: bashExe,
      args: ['--version'],
      expectStdout: /GNU bash/,
    })
    commands.push({
      label: 'managed sh.exe can resolve git and bash on PATH',
      command: shExe,
      args: [
        '-lc',
        'printf "OPENALICE_SH_OK\\n"; git --version; bash --version | head -n 1; command -v git; command -v bash',
      ],
      env: winEnv,
      expectStdout: /OPENALICE_SH_OK[\s\S]*git version [\s\S]*GNU bash/,
    })
  }

  return { ok: errors.length === 0, errors, commands }
}

export function packagedElectronExecutable(appRoot, platform) {
  if (platform === 'win32') return resolve(appRoot, '..', '..', 'OpenAlice.exe')
  if (platform === 'darwin') return resolve(appRoot, '..', '..', 'MacOS', 'OpenAlice')
  if (platform === 'linux') return resolve(appRoot, '..', '..', 'open-alice')
  return null
}

function runCommand(repoRoot, appRoot, spec) {
  console.log(`[packaged-toolchain] ${spec.label}`)
  console.log(`[packaged-toolchain] command: ${relative(repoRoot, spec.command)} ${spec.args.join(' ')}`)
  const result = spawnSync(spec.command, spec.args, {
    cwd: appRoot,
    encoding: 'utf8',
    env: { ...process.env, ...spec.env },
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  if (stdout.trim()) console.log(stdout.trim())
  if (stderr.trim()) console.error(stderr.trim())
  if (result.error) {
    throw new Error(`${spec.label} failed to start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`${spec.label} exited ${result.status ?? 'unknown'}${result.signal ? ` (${result.signal})` : ''}`)
  }
  if (spec.expectStdout && !spec.expectStdout.test(stdout)) {
    throw new Error(`${spec.label} stdout did not match ${spec.expectStdout}: ${JSON.stringify(stdout)}`)
  }
}

function main() {
  const packageResult = assertDesktopPackage()
  const plan = buildPackagedToolchainSmokePlan(packageResult)
  if (!plan.ok) {
    for (const error of plan.errors) console.error(error)
    process.exit(1)
  }
  const repoRoot = resolve(import.meta.dirname, '..')
  for (const command of plan.commands) {
    runCommand(repoRoot, packageResult.appRoot, command)
  }
  console.log('[packaged-toolchain] smoke OK')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (err) {
    console.error(`[packaged-toolchain] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
