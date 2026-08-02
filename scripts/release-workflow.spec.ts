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
  steps?: WorkflowStep[]
  strategy?: {
    matrix?: {
      include?: Array<{ os?: string; arch?: string }>
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
      'build-headless-runtime',
      'cli-installer-acceptance',
    ]))
  })
})
