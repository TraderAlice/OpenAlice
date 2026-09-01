import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

interface WorkflowStep {
  if?: string
  name?: string
  run?: string
  'timeout-minutes'?: number
}

interface WorkflowJob {
  if?: string
  needs?: string | string[]
  'timeout-minutes'?: number
  steps?: WorkflowStep[]
  strategy?: {
    matrix?: { os?: string[] }
  }
}

interface Workflow {
  on?: {
    push?: { branches?: string[] }
    pull_request?: { branches?: string[] }
  }
  jobs: Record<string, WorkflowJob>
}

const root = resolve(import.meta.dirname, '..')
const workflow = YAML.parse(
  readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
) as Workflow
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

function commands(job: WorkflowJob): string[] {
  return job.steps?.flatMap((step) => step.run ? [step.run] : []) ?? []
}

describe('CI workflow fast failure lanes', () => {
  it('leaves dev pushes to the CLI-only rolling publication workflow', () => {
    expect(workflow.on?.push?.branches).toEqual(['master'])
    expect(workflow.on?.pull_request?.branches).toEqual(expect.arrayContaining(['dev', 'master']))
    expect(workflow.jobs['post-merge-dev-smoke']).toBeUndefined()
  })

  it('runs build and unit tests independently', () => {
    const build = workflow.jobs.build
    const test = workflow.jobs.test

    expect(build.needs).toBeUndefined()
    expect(test.needs).toBeUndefined()
    expect(commands(build)).toContain('pnpm build')
    expect(commands(build)).not.toContain('pnpm test')
    expect(commands(test)).toContain('pnpm test')
    expect(commands(test)).not.toContain('pnpm build')
  })

  it('preserves build-and-test as the aggregate confidence gate', () => {
    const aggregate = workflow.jobs['build-and-test']

    expect(aggregate.if).toContain('always()')
    expect(aggregate.needs).toEqual(['build', 'test'])
    expect(aggregate.steps?.map((step) => step.name)).toContain(
      'Require successful build and test lanes',
    )
  })

  it('bounds cross-platform runners even when a step never reports completion', () => {
    expect(workflow.jobs['cross-platform-test']['timeout-minutes']).toBe(30)
  })

  it('keeps routine PR hosts focused while stable and scheduled lanes stay complete', () => {
    const crossPlatform = workflow.jobs['cross-platform-test']
    expect(crossPlatform.strategy?.matrix?.os).toEqual(['macos-14', 'windows-latest'])
    const platformContracts = crossPlatform.steps?.find(
      (step) => step.name === 'Run native platform contracts for routine integration PRs',
    )
    const fullBuild = crossPlatform.steps?.find(
      (step) => step.name === 'Build complete workspace for stable and scheduled validation',
    )
    const fullTest = crossPlatform.steps?.find(
      (step) => step.name === 'Run complete suite for stable and scheduled validation',
    )

    expect(platformContracts).toMatchObject({
      if: "github.event_name == 'pull_request' && github.base_ref != 'master'",
      run: 'pnpm test:platform-contracts',
      'timeout-minutes': 8,
    })
    for (const step of [fullBuild, fullTest]) {
      expect(step?.if).toBe("github.event_name != 'pull_request' || github.base_ref == 'master'")
    }
    expect(fullBuild?.run).toBe('pnpm build')
    expect(fullTest?.run).toBe('pnpm test')
    expect(packageJson.scripts['test:platform-contracts']).toContain('--project node')
    expect(packageJson.scripts['test:platform-contracts']).toContain('packages/cli/src')
    expect(packageJson.scripts['test:platform-contracts']).toContain('packages/guardian-runtime/src')
  })
})
