import { Writable, Readable } from 'node:stream'
import { execFile as execFileCallback } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

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
const execFile = promisify(execFileCallback)

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
    const catalog = JSON.parse(await readFile(join(destination, 'workspaces', 'state', 'workspace-catalog.json'), 'utf8'))
    expect(catalog.workspaces.map((workspace: { id: string }) => workspace.id)).toEqual(['ws-one'])
    await expect(stat(join(destination, 'workspaces', 'state', 'resume-identities.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const destinationCredentials = await readProjectTransferCredentialBundle(destination)
    expect(destinationCredentials.ai.credentials['openai-1']?.apiKey).toBe('sk-stream-secret')
    expect(destinationCredentials.ai.apiKeys['google']).toBe('legacy-stream-secret')
    expect(destinationCredentials.brokerAccounts).toEqual([
      expect.objectContaining({ presetId: 'alpaca-paper' }),
    ])
    expect(destinationCredentials.connectors).toEqual(expect.objectContaining({
      adapters: expect.objectContaining({ telegram: expect.any(Object) }),
    }))
    expect(await readFile(join(destination, 'sealing.key'), 'utf8')).not.toBe(sourceKey)
  })

  it('omits every credential and derived-backup canary outside the private bundle', async () => {
    const { destination, plan } = await fixture('omit')
    const stream = await serialize(plan)
    const streamText = stream.toString('utf8')

    for (const canary of [
      'sk-stream-secret',
      'legacy-stream-secret',
      'fmp-stream-secret',
      'backup-only-secret-canary',
      'web-session-secret-canary',
    ]) expect(streamText).not.toContain(canary)

    const receipt = await receiveProjectTransferStream({ source: Readable.from(stream) })
    expect(receipt.credentials).toBe('omitted')
    const portableAi = JSON.parse(await readFile(join(destination, 'data', 'config', 'ai-provider-manager.json'), 'utf8'))
    expect(portableAi.credentials).toEqual({})
    expect(portableAi.apiKeys).toEqual({})
    await expect(stat(join(destination, 'data', '_backup'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(destination, 'data', 'config', 'sessions.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(destination, 'sealing.key'))).rejects.toMatchObject({ code: 'ENOENT' })
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

  it('sends the consented credential snapshot when source credentials change later', async () => {
    const { source, destination, plan } = await fixture()
    await sealProjectTransferJson(source, join('data', 'config', 'accounts.json'), [
      { id: 'changed-after-consent', presetId: 'synthetic' },
    ])
    const stream = await serialize(plan)
    await receiveProjectTransferStream({ source: Readable.from(stream) })
    const received = await readProjectTransferCredentialBundle(destination)
    expect(received.brokerAccounts).toEqual([
      expect.objectContaining({ presetId: 'alpaca-paper' }),
    ])
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

  it.skipIf(process.platform === 'win32')('rejects a destination whose parent resolves through a symlink', async () => {
    const { source } = await fixture('omit')
    const destinationRoot = await mkdtemp(join(tmpdir(), 'oa-stream-canonical-destination-'))
    roots.push(destinationRoot)
    const canonicalParent = join(destinationRoot, 'canonical')
    const aliasParent = join(destinationRoot, 'alias')
    await mkdir(canonicalParent)
    await symlink(canonicalParent, aliasParent)
    const destination = join(aliasParent, 'remote-home')
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
      credentials: 'omit',
      isGitTracked: async () => false,
    })
    await expect(receiveProjectTransferStream({ source: Readable.from(await serialize(plan)) }))
      .rejects.toThrow('resolves through a symlink')
    await expect(stat(join(canonicalParent, 'remote-home'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('publishes a self-contained ordinary Git Workspace without local credentials', async () => {
    const { source, destination } = await fixture('omit')
    const workspace = join(source, 'workspaces', 'workspaces', 'ws-one')
    await execFile('git', ['init', '-q'], { cwd: workspace })
    await execFile('git', ['add', 'README.md'], { cwd: workspace })
    await execFile('git', [
      '-c', 'user.name=OpenAlice Test',
      '-c', 'user.email=openalice@example.test',
      'commit', '-qm', 'fixture',
    ], { cwd: workspace })
    await execFile('git', ['config', '--local', 'http.https://example.test/.extraHeader', 'Authorization: Bearer secret-canary'], { cwd: workspace })
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
      credentials: 'omit',
    })
    expect(plan.readyToApply).toBe(true)
    await receiveProjectTransferStream({ source: Readable.from(await serialize(plan)) })
    const receivedWorkspace = join(destination, 'workspaces', 'workspaces', 'ws-one')
    await expect(stat(join(receivedWorkspace, '.git', 'config'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(execFile('git', ['status', '--porcelain'], { cwd: receivedWorkspace }))
      .resolves.toMatchObject({ stdout: '' })
    await expect(execFile('git', ['fsck', '--connectivity-only', '--no-dangling'], { cwd: receivedWorkspace }))
      .resolves.toMatchObject({ stderr: '' })
  })

  it('retries registration idempotently after files were already published', async () => {
    const { destination, plan } = await fixture()
    const stream = await serialize(plan)
    await expect(receiveProjectTransferStream({
      source: Readable.from(stream),
      register: async () => { throw new Error('synthetic registration failure') },
    })).rejects.toThrow('synthetic registration failure')
    expect(await readFile(join(destination, 'portable.txt'), 'utf8')).toBe('PORTABLE-CONTENT\n')
    const receiptPath = join(destination, '.openalice-transfer-receipt.json')
    const storedReceipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    await writeJson(receiptPath, { ...storedReceipt, secretCanary: 'must-not-return' })

    let registrations = 0
    const retried = await receiveProjectTransferStream({
      source: Readable.from(stream),
      register: async () => { registrations += 1 },
    })
    expect(retried).toMatchObject({ transferId: plan.transferId })
    expect(JSON.stringify(retried)).not.toContain('secretCanary')
    expect(registrations).toBe(1)
  })

  it('retries registration when credential import created a previously absent AI vault', async () => {
    const { destination, plan } = await fixture('include', false, false)
    expect(plan.portable.entries.some((entry) => (
      entry.path === 'data/config/ai-provider-manager.json'
    ))).toBe(false)
    const stream = await serialize(plan)

    await expect(receiveProjectTransferStream({
      source: Readable.from(stream),
      register: async () => { throw new Error('synthetic registration failure') },
    })).rejects.toThrow('synthetic registration failure')
    await expect(stat(join(destination, 'data', 'config', 'ai-provider-manager.json'))).resolves.toBeDefined()

    let registrations = 0
    await expect(receiveProjectTransferStream({
      source: Readable.from(stream),
      register: async () => { registrations += 1 },
    })).resolves.toMatchObject({ transferId: plan.transferId })
    expect(registrations).toBe(1)
  })

  it('re-plans the same transaction in a new process and repairs registration', async () => {
    const { source, destination, plan } = await fixture('omit', true)
    await expect(receiveProjectTransferStream({
      source: Readable.from(await serialize(plan)),
      register: async () => { throw new Error('synthetic registration failure') },
    })).rejects.toThrow('synthetic registration failure')

    const replanned = await planProjectTransfer({
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
      credentials: 'omit',
      isGitTracked: async () => false,
    })
    expect(replanned.transferId).toBe(plan.transferId)
    let registrations = 0
    await expect(receiveProjectTransferStream({
      source: Readable.from(await serialize(replanned)),
      register: async () => { registrations += 1 },
    })).resolves.toMatchObject({ transferId: plan.transferId })
    expect(registrations).toBe(1)
  })

  it('refuses registration retry when published files changed after the receipt', async () => {
    const { destination, plan } = await fixture()
    const stream = await serialize(plan)
    await expect(receiveProjectTransferStream({
      source: Readable.from(stream),
      register: async () => { throw new Error('synthetic registration failure') },
    })).rejects.toThrow('synthetic registration failure')

    await writeFile(join(destination, 'portable.txt'), 'TAMPERED-AFTER-PUBLISH\n')
    let registrations = 0
    await expect(receiveProjectTransferStream({
      source: Readable.from(stream),
      register: async () => { registrations += 1 },
    })).rejects.toThrow('destination changed before registration retry')
    expect(registrations).toBe(0)
  })

  it('refuses registration retry when an unexpected file was added after publish', async () => {
    const { destination, plan } = await fixture('omit')
    const stream = await serialize(plan)
    await expect(receiveProjectTransferStream({
      source: Readable.from(stream),
      register: async () => { throw new Error('synthetic registration failure') },
    })).rejects.toThrow('synthetic registration failure')

    await writeJson(join(destination, 'data', 'config', 'auth.json'), { token: 'unexpected' })
    await expect(receiveProjectTransferStream({ source: Readable.from(stream) }))
      .rejects.toThrow('destination changed before registration retry')
  })
})

async function fixture(
  credentials: 'include' | 'omit' = 'include',
  deterministicTransferId = false,
  includeAiVault = true,
) {
  const source = await mkdtemp(join(tmpdir(), 'oa-stream-source-'))
  const destinationParent = await realpath(await mkdtemp(join(tmpdir(), 'oa-stream-destination-')))
  roots.push(source, destinationParent)
  const destination = join(destinationParent, 'remote-home')
  await writeAliceProjectProductStamp(source, 'trader')
  await writeFile(join(source, 'portable.txt'), 'PORTABLE-CONTENT\n')
  if (includeAiVault) {
    await writeJson(join(source, 'data', 'config', 'ai-provider-manager.json'), {
      profiles: { default: { backend: 'native' } },
      apiKeys: { google: 'legacy-stream-secret' },
      credentials: {
        'openai-1': { vendor: 'openai', authType: 'api-key', apiKey: 'sk-stream-secret' },
      },
    })
  }
  await writeJson(join(source, 'data', 'config', 'market-data.json'), {
    providerKeys: { fmp: 'fmp-stream-secret' },
  })
  await writeJson(join(source, 'data', '_backup', 'before', 'config', 'ai-provider-manager.json'), {
    apiKeys: { backup: 'backup-only-secret-canary' },
  })
  await writeJson(join(source, 'data', 'config', 'ai-provider-manager.json.backup'), {
    apiKeys: { backup: 'backup-only-secret-canary' },
  })
  await writeJson(join(source, 'data', 'config', 'sessions.json'), {
    sessions: [{ sid: 'web-session-secret-canary' }],
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
    workspaces: [
      { id: 'ws-one', tag: 'One', activeDir: workspace, lifecycle: 'active' },
      {
        id: '.pi-agent',
        tag: 'Pi Agent',
        activeDir: join(source, 'workspaces', 'departed-workspaces', '.pi-agent'),
        departedDir: join(source, 'workspaces', 'departed-workspaces', '.pi-agent'),
        lifecycle: 'departed',
        legacyImported: true,
      },
    ],
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
    credentials,
    ...(deterministicTransferId ? {} : { randomId: () => 'transfer-stream-test' }),
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
