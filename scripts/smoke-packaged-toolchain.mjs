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

  const searchTools = packageResult.manifest.searchTools?.[packageResult.platformArch]
  if ((packageResult.platform === 'win32' || packageResult.platform === 'darwin') && !searchTools) {
    errors.push(`[packaged-toolchain] missing managed fd/rg manifest entry ${packageResult.platformArch}`)
    return { ok: false, errors, commands }
  }
  if (searchTools) {
    const searchToolsRoot = join(packageResult.appRoot, searchTools.path)
    const searchToolsBin = join(searchToolsRoot, searchTools.binPath)
    const fdBinary = join(searchToolsRoot, searchTools.fd.binary)
    const rgBinary = join(searchToolsRoot, searchTools.rg.binary)
    const searchToolsEnv = {
      PATH: [searchToolsBin, process.env['PATH']].filter(Boolean).join(delimiter),
    }
    commands.push({
      label: 'managed fd',
      command: fdBinary,
      args: ['--version'],
      expectStdout: /^fd \d+\.\d+\.\d+/m,
    })
    commands.push({
      label: 'managed ripgrep',
      command: rgBinary,
      args: ['--version'],
      expectStdout: /^ripgrep \d+\.\d+\.\d+/m,
    })

    const piToolsManager = join(
      packageResult.appRoot,
      'vendor',
      'pi',
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'dist',
      'utils',
      'tools-manager.js',
    )
    const piProbe = [
      `import(${JSON.stringify(pathToFileURL(piToolsManager).href)})`,
      '.then((m) => console.log("OPENALICE_PI_SEARCH_TOOLS_OK " + m.getToolPath("fd") + " " + m.getToolPath("rg")))',
      '.catch((err) => { console.error(err); process.exit(1) })',
    ].join('')
    commands.push({
      label: 'managed Pi resolves packaged fd/rg without download',
      command: electron,
      args: ['-e', piProbe],
      env: {
        ...searchToolsEnv,
        ELECTRON_RUN_AS_NODE: '1',
        PI_CODING_AGENT_DIR: join(packageResult.appRoot, '.missing-smoke-pi-agent'),
      },
      expectStdout: /OPENALICE_PI_SEARCH_TOOLS_OK fd rg/,
    })
  }

  commands.push({
    label: 'workspace CLI payload through packaged Electron Node',
    command: electron,
    args: [join(packageResult.appRoot, 'src', 'workspaces', 'cli', 'bin', 'openalice-cli.cjs')],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      OPENALICE_CLI_BIN: 'traderhub',
    },
    expectStatus: 1,
    expectStderr: /traderhub: AQ_WS_ID is not set/,
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
    const workspaceCliDir = join(packageResult.appRoot, 'src', 'workspaces', 'cli', 'bin')
    const toolchainPath = (Array.isArray(git.toolchainPaths) ? git.toolchainPaths : ['cmd', 'bin', 'usr/bin'])
      .map((entry) => join(gitRoot, entry))
      .join(delimiter)
    const managedSearchToolsBin = searchTools
      ? join(packageResult.appRoot, searchTools.path, searchTools.binPath)
      : null
    const winEnv = {
      PATH: [workspaceCliDir, managedSearchToolsBin, toolchainPath, process.env['PATH']]
        .filter(Boolean)
        .join(delimiter),
      CHERE_INVOKING: '1',
      MSYSTEM: packageResult.platformArch.endsWith('arm64') ? 'CLANGARM64' : 'MINGW64',
      OPENALICE_MANAGED_PI_NODE_PATH: electron,
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
    commands.push({
      label: 'Workspace CLI launcher through managed Git Bash',
      command: bashExe,
      args: ['--noprofile', '--norc', '-c', 'alice --help'],
      env: winEnv,
      expectStatus: 1,
      expectStderr: /alice: AQ_WS_ID is not set/,
    })
    commands.push({
      label: 'Workspace CLI transport env through managed Git Bash',
      command: bashExe,
      args: ['--noprofile', '--norc', '-c', 'alice --help'],
      env: {
        ...winEnv,
        AQ_WS_ID: 'workspace-toolchain-smoke',
        OPENALICE_TOOL_URL: '/cli',
        OPENALICE_TOOL_SOCKET: '\\\\.\\pipe\\openalice-toolchain-missing',
        OPENALICE_CLI_DEBUG: '1',
      },
      expectStatus: 1,
      expectStdout: /"toolUrl":"\/cli"/,
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
  const expectedStatus = spec.expectStatus ?? 0
  if (result.status !== expectedStatus) {
    throw new Error(
      `${spec.label} exited ${result.status ?? 'unknown'} instead of ${expectedStatus}` +
      `${result.signal ? ` (${result.signal})` : ''}`,
    )
  }
  if (spec.expectStdout && !spec.expectStdout.test(stdout)) {
    throw new Error(`${spec.label} stdout did not match ${spec.expectStdout}: ${JSON.stringify(stdout)}`)
  }
  if (spec.expectStderr && !spec.expectStderr.test(stderr)) {
    throw new Error(`${spec.label} stderr did not match ${spec.expectStderr}: ${JSON.stringify(stderr)}`)
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
