import { EventEmitter } from 'node:events'
import type { ChildProcess, spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { transferProjectOverSsh } from './project-transfer-ssh.ts'
import type { ProjectTransferPlan } from './project-transfer.ts'

describe('AliceProject SSH transfer transport', () => {
  it('streams to the registered target and accepts only the matching receipt', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const receipt = matchingReceipt()
    const spawnProcess = fakeSpawn((child, command, args) => {
      calls.push({ command, args })
      child.stdin.once('finish', () => {
        child.stdout.end(`${JSON.stringify(receipt)}\n`)
        child.emit('exit', 0, null)
      })
    })
    await expect(transferProjectOverSsh({
      machine: machine(),
      plan: transferPlan(),
      spawnProcess,
    })).resolves.toEqual(receipt)
    expect(calls[0]?.command).toBe('ssh')
    expect(calls[0]?.args).toContain('alice@example.test')
    expect(calls[0]?.args.join(' ')).toContain('project transfer-receive')
  })

  it('rejects malformed and cross-transaction receipts', async () => {
    for (const output of [
      'not-json\n',
      JSON.stringify({ ...matchingReceipt(), transferId: 'another-transfer' }),
    ]) {
      const spawnProcess = fakeSpawn((child) => {
        child.stdin.once('finish', () => {
          child.stdout.end(output)
          child.emit('exit', 0, null)
        })
      })
      await expect(transferProjectOverSsh({
        machine: machine(),
        plan: transferPlan(),
        spawnProcess,
      })).rejects.toMatchObject({ code: 'ETRANSSSH' })
    }
  })

  it('bounds and sanitizes remote failure diagnostics', async () => {
    const diagnostics: string[] = []
    const spawnProcess = fakeSpawn((child) => {
      child.stdin.once('finish', () => {
        child.stderr.write('receiver\u0000 failed\n')
        child.stderr.end()
        child.emit('exit', 23, null)
      })
    })
    await expect(transferProjectOverSsh({
      machine: machine(),
      plan: transferPlan(),
      spawnProcess,
      stderr: { write: (value) => diagnostics.push(value) },
    })).rejects.toThrow('receiver failed')
    expect(diagnostics).toEqual(['receiver\u0000 failed\n'])
  })
})

function fakeSpawn(
  setup: (child: FakeChild, command: string, args: readonly string[]) => void,
): typeof spawn {
  return ((command: string, args: readonly string[]) => {
    const child = new EventEmitter() as FakeChild
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    queueMicrotask(() => setup(child, command, args))
    return child as unknown as ChildProcess
  }) as typeof spawn
}

type FakeChild = EventEmitter & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  kill(signal?: NodeJS.Signals): boolean
}

function machine() {
  return {
    key: 'cloud',
    displayName: 'Cloud',
    sshTarget: 'alice@example.test',
    sshPort: 2222,
    identityFile: '/tmp/synthetic-key',
    isDefault: true,
  }
}

function transferPlan(): ProjectTransferPlan {
  return {
    schemaVersion: 1,
    transferId: 'transfer-ssh-test',
    generatedAt: '2026-08-23T00:00:00.000Z',
    source: {
      projectId: 'alice-project-source-test',
      key: 'source',
      displayName: 'Source',
      home: '/tmp/source',
      product: 'trader',
    },
    destination: {
      machineKey: 'cloud',
      projectId: 'alice-project-destination-test',
      key: 'copy',
      displayName: 'Copy',
      home: '/home/alice/.openalice-copy',
      requiredFreeBytes: 64 * 1024 * 1024,
    },
    policy: { credentials: 'omit', scheduledIssues: 'keep-blocked' },
    portable: { entries: [], files: 0, directories: 0, symlinks: 0, bytes: 0 },
    excluded: [],
    credentials: {
      ai: { count: 0, vendors: [] },
      broker: { count: 0, presets: [] },
      connector: { count: 0, adapters: [] },
      providerKeys: { count: 0, vendors: [] },
    },
    scheduledIssues: [],
    blockers: [],
    readyToApply: true,
  }
}

function matchingReceipt() {
  return {
    schemaVersion: 1 as const,
    transferId: 'transfer-ssh-test',
    sourceProjectId: 'alice-project-source-test',
    destinationProjectId: 'alice-project-destination-test',
    destinationHome: '/home/alice/.openalice-copy',
    files: 0,
    bytes: 0,
    manifestSha256: '0'.repeat(64),
    credentials: 'omitted' as const,
    sessionsImported: 0 as const,
    publishedAt: '2026-08-23T00:01:00.000Z',
  }
}
