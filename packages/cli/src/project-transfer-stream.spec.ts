import { Writable, Readable } from 'node:stream'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { writeAliceProjectProductStamp } from './alice-project-product.ts'
import { planProjectTransfer } from './project-transfer.ts'
import {
  readProjectTransferCredentialBundle,
  sealProjectTransferJson,
} from './project-transfer-secrets.ts'
import {
  receiveProjectTransferStream,
  writeProjectTransferStream,
} from './project-transfer-stream.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('AliceProject transfer stream', () => {
  it('stages, verifies, re-seals, and atomically publishes portable state', async () => {
    const { source, destination, plan } = await fixture()
    const sourceKey = await readFile(join(source, 'sealing.key'), 'utf8')
    const stream = await serialize(plan)
    const registered: string[] = []
    const receipt = await receiveProjectTransferStream({
      source: Readable.from(stream),
      now: () => new Date('2026-08-23T01:00:00Z'),
      register: async (receivedPlan) => { registered.push(receivedPlan.destination.key) },
    })

    expect(receipt).toMatchObject({
      transferId: 'transfer-stream-test',
      destinationHome: plan.destination.home,
      credentials: 'included',
      sessionsImported: 0,
    })
    expect(registered).toEqual(['remote-copy'])
    expect(await readFile(join(destination, 'portable.txt'), 'utf8')).toBe('PORTABLE-CONTENT\n')
    const registry = JSON.parse(await readFile(join(destination, 'workspaces', 'workspaces.json'), 'utf8'))
    expect(registry.workspaces[0].dir).toBe(join(plan.destination.home, 'workspaces', 'workspaces', 'ws-one'))
    await expect(stat(join(destination, 'workspaces', 'state', 'resume-identities.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const destinationCredentials = await readProjectTransferCredentialBundle(destination)
    expect(destinationCredentials.ai.credentials['openai-1']?.apiKey).toBe('sk-stream-secret')
    expect(destinationCredentials.brokerAccounts).toEqual([
      expect.objectContaining({ presetId: 'alpaca-paper' }),
    ])
    expect(destinationCredentials.connectors).toEqual(expect.objectContaining({
      adapters: expect.objectContaining({ telegram: expect.any(Object) }),
    }))
    expect(await readFile(join(destination, 'sealing.key'), 'utf8')).not.toBe(sourceKey)
  })

  it('leaves only marked staging on checksum failure and safely retries the same transaction', async () => {
    const { destination, plan } = await fixture()
    const valid = await serialize(plan)
    const corrupted = Buffer.from(valid)
    const offset = corrupted.indexOf(Buffer.from('PORTABLE-CONTENT'))
    expect(offset).toBeGreaterThan(0)
    corrupted[offset] = corrupted[offset]! ^ 0xff

    await expect(receiveProjectTransferStream({ source: Readable.from(corrupted) }))
      .rejects.toThrow('Checksum mismatch')
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
    const staging = join(dirname(destination), `.openalice-transfer-${plan.transferId}.staging`)
    const marker = JSON.parse(await readFile(join(staging, '.openalice-transfer-transaction.json'), 'utf8'))
    expect(marker).toMatchObject({
      transferId: plan.transferId,
      destination: plan.destination.home,
      state: 'failed',
    })

    await expect(receiveProjectTransferStream({ source: Readable.from(valid) })).resolves.toMatchObject({
      transferId: plan.transferId,
    })
    expect(await readFile(join(destination, 'portable.txt'), 'utf8')).toBe('PORTABLE-CONTENT\n')
  })

  it('refuses source changes after planning', async () => {
    const { source, plan } = await fixture()
    await writeFile(join(source, 'portable.txt'), 'CHANGED-AFTER-PLAN\n')
    await expect(serialize(plan)).rejects.toThrow('changed after planning')
  })

  it('reports completed portable file and byte progress', async () => {
    const { plan } = await fixture()
    const progress: Array<{ files: number; bytes: number; totalFiles: number; totalBytes: number }> = []
    const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })

    await writeProjectTransferStream({ plan, output, onProgress: (next) => progress.push(next) })

    expect(progress.at(-1)).toEqual({
      files: plan.portable.files,
      bytes: plan.portable.bytes,
      totalFiles: plan.portable.files,
      totalBytes: plan.portable.bytes,
    })
  })

  it('does not overwrite an occupied destination', async () => {
    const { destination, plan } = await fixture()
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'owner.txt'), 'existing\n')
    await expect(receiveProjectTransferStream({ source: Readable.from(await serialize(plan)) }))
      .rejects.toThrow('Destination already exists')
    expect(await readFile(join(destination, 'owner.txt'), 'utf8')).toBe('existing\n')
  })

  it('rejects insufficient destination space before creating staging', async () => {
    const { destination, plan } = await fixture()
    const staging = join(dirname(destination), `.openalice-transfer-${plan.transferId}.staging`)
    await expect(receiveProjectTransferStream({
      source: Readable.from(await serialize(plan)),
      availableBytes: async () => plan.destination.requiredFreeBytes - 1,
    })).rejects.toThrow('insufficient free space')
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(staging)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retries registration idempotently after files were already published', async () => {
    const { destination, plan } = await fixture()
    const stream = await serialize(plan)
    await expect(receiveProjectTransferStream({
      source: Readable.from(stream),
      register: async () => { throw new Error('synthetic registration failure') },
    })).rejects.toThrow('synthetic registration failure')
    expect(await readFile(join(destination, 'portable.txt'), 'utf8')).toBe('PORTABLE-CONTENT\n')

    let registrations = 0
    await expect(receiveProjectTransferStream({
      source: Readable.from(stream),
      register: async () => { registrations += 1 },
    })).resolves.toMatchObject({ transferId: plan.transferId })
    expect(registrations).toBe(1)
  })
})

async function fixture() {
  const source = await mkdtemp(join(tmpdir(), 'oa-stream-source-'))
  const destinationParent = await mkdtemp(join(tmpdir(), 'oa-stream-destination-'))
  roots.push(source, destinationParent)
  const destination = join(destinationParent, 'remote-home')
  await writeAliceProjectProductStamp(source, 'trader')
  await writeFile(join(source, 'portable.txt'), 'PORTABLE-CONTENT\n')
  await writeJson(join(source, 'data', 'config', 'ai-provider-manager.json'), {
    profiles: { default: { backend: 'native' } },
    credentials: {
      'openai-1': { vendor: 'openai', authType: 'api-key', apiKey: 'sk-stream-secret' },
    },
  })
  await writeJson(join(source, 'data', 'config', 'market-data.json'), {
    providerKeys: { fmp: 'fmp-stream-secret' },
  })
  await sealProjectTransferJson(source, join('data', 'config', 'accounts.json'), [
    { id: 'paper', presetId: 'alpaca-paper', presetConfig: { apiKey: 'broker-stream-secret' } },
  ])
  await sealProjectTransferJson(source, join('data', 'config', 'connectors.json'), {
    version: 1,
    adapters: { telegram: { enabled: true, settings: { token: 'connector-stream-secret-value' } } },
  })
  const workspace = join(source, 'workspaces', 'workspaces', 'ws-one')
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'README.md'), 'workspace\n')
  await writeJson(join(source, 'workspaces', 'workspaces.json'), {
    version: 1,
    workspaces: [{ id: 'ws-one', tag: 'One', dir: workspace, createdAt: '2026-08-23T00:00:00Z' }],
  })
  await writeJson(join(source, 'workspaces', 'state', 'workspace-catalog.json'), {
    version: 1,
    workspaces: [{ id: 'ws-one', tag: 'One', activeDir: workspace, lifecycle: 'active' }],
  })
  await writeJson(join(source, 'workspaces', 'state', 'resume-identities.json'), {
    version: 1,
    records: { old: { nativeSessionId: 'must-not-transfer' } },
  })
  const plan = await planProjectTransfer({
    source: {
      id: 'alice-project-source',
      key: 'source',
      displayName: 'Source',
      home: source,
      port: 47331,
      portAutomatic: true,
      isDefault: true,
    },
    destinationMachineKey: 'cloud',
    destinationProjectKey: 'remote-copy',
    destinationHome: destination,
    scheduledIssues: 'keep-blocked',
    randomId: () => 'transfer-stream-test',
    now: () => new Date('2026-08-23T00:00:00Z'),
    isGitTracked: async () => false,
  })
  return { source, destination, plan }
}

async function serialize(plan: Awaited<ReturnType<typeof planProjectTransfer>>): Promise<Buffer> {
  const chunks: Buffer[] = []
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
  await writeProjectTransferStream({ plan, output })
  return Buffer.concat(chunks)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
