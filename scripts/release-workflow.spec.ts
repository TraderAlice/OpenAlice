import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

interface WorkflowStep {
  name?: string
  uses?: string
  with?: Record<string, unknown>
}

interface WorkflowJob {
  needs?: string | string[]
  'timeout-minutes'?: number
  steps?: WorkflowStep[]
  strategy?: {
    matrix?: {
      include?: Array<{ os?: string; platform?: string; arch?: string }>
    }
  }
}

const root = resolve(import.meta.dirname, '..')
const workflow = YAML.parse(
  readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8'),
) as { jobs: Record<string, WorkflowJob> }

function step(job: WorkflowJob, name: string): WorkflowStep {
  const found = job.steps?.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`release workflow step is missing: ${name}`)
  return found
}

function needs(job: WorkflowJob): string[] {
  if (!job.needs) return []
  return Array.isArray(job.needs) ? job.needs : [job.needs]
}

describe('Release workflow critical path', () => {
  it('bounds native candidate jobs without weakening downstream gates', () => {
    expect(workflow.jobs['build-desktop']['timeout-minutes']).toBe(45)
    expect(workflow.jobs['build-broker-packs']['timeout-minutes']).toBe(30)
    expect(workflow.jobs['build-cli-release']['timeout-minutes']).toBe(35)
  })

  it('builds native Broker Packs outside the desktop package jobs', () => {
    const desktop = workflow.jobs['build-desktop']
    const brokerPacks = workflow.jobs['build-broker-packs']

    expect(desktop.steps?.map((candidate) => candidate.name)).not.toContain('Build optional Broker Packs')
    expect(brokerPacks.strategy?.matrix?.include).toEqual([
      { os: 'macos-14', arch: 'arm64' },
      { os: 'macos-15-intel', arch: 'x64' },
      { os: 'windows-latest', arch: 'x64' },
      { os: 'ubuntu-latest', arch: 'x64' },
    ])
    expect(step(brokerPacks, 'Preserve Broker Packs').with?.['name']).toBe(
      'broker-packs-${{ runner.os }}-${{ matrix.arch }}',
    )
  })

  it('preserves desktop candidates before running retriable N-1 acceptance', () => {
    const desktop = workflow.jobs['build-desktop']
    const upgrade = workflow.jobs['accept-desktop-upgrade']

    expect(step(desktop, 'Preserve desktop release candidate').uses).toBe('actions/upload-artifact@v4')
    expect(desktop.steps?.map((candidate) => candidate.name)).not.toContain(
      'Prove final desktop artifact upgrades previous release state',
    )
    expect(needs(upgrade)).toEqual(['release', 'build-desktop'])
    expect(step(upgrade, 'Restore desktop release candidate').uses).toBe('actions/download-artifact@v4')
    expect(step(upgrade, 'Prove final desktop artifact upgrades previous release state')).toBeDefined()
  })

  it('keeps publication gated on both candidate builds and upgrade receipts', () => {
    expect(needs(workflow.jobs['publish-release'])).toEqual(expect.arrayContaining([
      'build-desktop',
      'accept-desktop-upgrade',
      'build-broker-packs',
      'build-cli-release',
      'cli-installer-acceptance',
    ]))
  })

  it('publishes the four accepted native CLI archives and checksums', () => {
    const nativeCli = workflow.jobs['build-cli-release']
    const publication = workflow.jobs['publish-release']

    expect(nativeCli.strategy?.matrix?.include).toEqual([
      { os: 'macos-14', platform: 'darwin', arch: 'arm64' },
      { os: 'macos-15-intel', platform: 'darwin', arch: 'x64' },
      { os: 'ubuntu-24.04', platform: 'linux', arch: 'x64' },
      { os: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64' },
    ])
    expect(nativeCli.steps?.some((candidate) => candidate.uses === 'oven-sh/setup-bun@v2')).toBe(true)
    expect(step(nativeCli, 'Preserve accepted native CLI').with?.name).toBe(
      'cli-release-${{ matrix.platform }}-${{ matrix.arch }}',
    )
    expect(step(publication, 'Create tag and GitHub Release from accepted candidates').with?.files)
      .toContain('dist/release-cli/*.tar.gz.sha256')
  })
})
