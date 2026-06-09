import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { disableTargetlessCronJobs } from './0008_disable_targetless_cron_jobs/index.js'

function tempPath(ext: string): string {
  return join(tmpdir(), `migration-0008-${randomUUID()}.${ext}`)
}

interface RawJob {
  id: string
  name: string
  enabled: boolean
  workspaceId?: string
  agent?: string
}

function makeJob(name: string, opts: { enabled?: boolean; workspaceId?: string } = {}): RawJob {
  return {
    id: randomUUID().slice(0, 8),
    name,
    enabled: opts.enabled ?? true,
    ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
  }
}

async function writeJobs(path: string, jobs: RawJob[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify({ jobs }, null, 2))
}

async function readJobs(path: string): Promise<{ jobs: RawJob[] }> {
  return JSON.parse(await readFile(path, 'utf-8')) as { jobs: RawJob[] }
}

describe('0008_disable_targetless_cron_jobs', () => {
  let jobsPath: string

  beforeEach(() => {
    jobsPath = tempPath('json')
  })

  afterEach(async () => {
    await rm(jobsPath, { force: true })
  })

  it('disables enabled jobs that have no workspaceId', async () => {
    await writeJobs(jobsPath, [
      makeJob('legacy', { enabled: true }),
      makeJob('targeted', { enabled: true, workspaceId: 'ws-1' }),
    ])

    const result = await disableTargetlessCronJobs(jobsPath)

    expect(result.disabled).toEqual(['legacy'])
    const after = await readJobs(jobsPath)
    expect(after.jobs.find((j) => j.name === 'legacy')!.enabled).toBe(false)
    expect(after.jobs.find((j) => j.name === 'targeted')!.enabled).toBe(true)
  })

  it('leaves already-disabled targetless jobs untouched', async () => {
    await writeJobs(jobsPath, [makeJob('legacy-off', { enabled: false })])
    const result = await disableTargetlessCronJobs(jobsPath)
    expect(result.disabled).toEqual([])
  })

  it('no-op when every job has a workspaceId', async () => {
    await writeJobs(jobsPath, [
      makeJob('a', { workspaceId: 'ws-1' }),
      makeJob('b', { workspaceId: 'ws-2' }),
    ])
    const result = await disableTargetlessCronJobs(jobsPath)
    expect(result.disabled).toEqual([])
  })

  it('no-op when file does not exist', async () => {
    const result = await disableTargetlessCronJobs(jobsPath)
    expect(result.disabled).toEqual([])
  })

  it('idempotent — second run leaves the file byte-for-byte unchanged', async () => {
    await writeJobs(jobsPath, [
      makeJob('legacy', { enabled: true }),
      makeJob('targeted', { enabled: true, workspaceId: 'ws-1' }),
    ])

    await disableTargetlessCronJobs(jobsPath)
    const afterFirst = await readFile(jobsPath, 'utf-8')

    const result = await disableTargetlessCronJobs(jobsPath)
    const afterSecond = await readFile(jobsPath, 'utf-8')

    expect(result.disabled).toEqual([])
    expect(afterSecond).toBe(afterFirst)
  })
})
