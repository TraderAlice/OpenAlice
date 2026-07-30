import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  inspectManagedSource,
  inspectSourceCheckout,
  prepareManagedSource,
} from './managed-source.ts'

const temporaryPaths: string[] = []
const branchSource = {
  schemaVersion: 1 as const,
  repository: 'TraderAlice/OpenAlice',
  cliVersion: '0.87.0-beta',
  selector: { kind: 'branch' as const, value: 'dev' },
  installerUrl: 'https://openalice.ai/install',
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryPaths.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )))
})

describe('managed local source', () => {
  it('atomically prepares and then reuses the branch paired with the CLI', async () => {
    const installRoot = await temporaryInstallRoot()
    const calls: string[][] = []
    const runGit = vi.fn(async (args: string[]) => {
      calls.push(args)
      const destination = args.at(-1)
      if (args[0] !== 'clone' || !destination) return
      await writeValidCheckout(destination)
    })

    const first = await prepareManagedSource({
      installSource: branchSource,
      layout: { installRoot },
      repositoryUrl: '/fixture/OpenAlice.git',
    }, { runGit })

    expect(first.created).toBe(true)
    expect(first.state).toBe('present')
    expect(first.appDir).toMatch(
      /sources[/\\]branch-dev-[a-f0-9]{8}[/\\]OpenAlice$/,
    )
    expect(calls).toEqual([[
      'clone',
      '--branch',
      'dev',
      '--single-branch',
      '/fixture/OpenAlice.git',
      expect.stringContaining('.OpenAlice.prepare.'),
    ]])

    const reused = await prepareManagedSource({
      installSource: branchSource,
      layout: { installRoot },
      repositoryUrl: '/fixture/OpenAlice.git',
    }, { runGit })
    expect(reused).toEqual(expect.objectContaining({
      appDir: first.appDir,
      created: false,
      state: 'present',
    }))
    expect(runGit).toHaveBeenCalledTimes(1)
  })

  it('checks out an immutable version after cloning', async () => {
    const installRoot = await temporaryInstallRoot()
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === 'clone') {
        const destination = args.at(-1)
        if (destination) await writeValidCheckout(destination)
      }
    })

    const result = await prepareManagedSource({
      installSource: {
        ...branchSource,
        selector: { kind: 'version', value: 'v0.87.0' },
      },
      layout: { installRoot },
      repositoryUrl: '/fixture/OpenAlice.git',
    }, { runGit })

    expect(result.created).toBe(true)
    expect(runGit).toHaveBeenNthCalledWith(
      1,
      ['clone', '/fixture/OpenAlice.git', expect.any(String)],
      expect.any(Object),
    )
    expect(runGit).toHaveBeenNthCalledWith(
      2,
      ['-C', expect.any(String), 'checkout', '--detach', 'v0.87.0'],
      expect.any(Object),
    )
  })

  it('refuses an occupied path that is not a checkout', async () => {
    const installRoot = await temporaryInstallRoot()
    const plan = await inspectManagedSource({
      installSource: branchSource,
      layout: { installRoot },
    })
    await mkdir(plan.appDir, { recursive: true })
    await writeFile(join(plan.appDir, 'package.json'), '{"name":"other"}\n')

    await expect(prepareManagedSource({
      installSource: branchSource,
      layout: { installRoot },
    })).rejects.toThrow('exists but is not an OpenAlice checkout')
  })

  it('reuses a valid checkout that wins a concurrent prepare race', async () => {
    const installRoot = await temporaryInstallRoot()
    const plan = await inspectManagedSource({
      installSource: branchSource,
      layout: { installRoot },
    })

    const result = await prepareManagedSource({
      installSource: branchSource,
      layout: { installRoot },
    }, {
      runGit: async () => {
        await writeValidCheckout(plan.appDir)
        throw new Error('destination appeared concurrently')
      },
    })

    expect(result).toEqual(expect.objectContaining({
      appDir: plan.appDir,
      created: false,
      state: 'present',
    }))
  })

  it('requires an installed layout and reports missing checkouts', async () => {
    await expect(inspectManagedSource({
      installSource: branchSource,
      layout: null,
    })).rejects.toThrow('available from an installed OpenAlice CLI')

    const installRoot = await temporaryInstallRoot()
    expect(await inspectSourceCheckout(join(installRoot, 'missing'))).toBe('absent')
  })
})

async function temporaryInstallRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-managed-source-'))
  temporaryPaths.push(root)
  return root
}

async function writeValidCheckout(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'package.json'), JSON.stringify({
    name: 'open-alice',
    scripts: { 'build:server': 'true' },
  }))
}
