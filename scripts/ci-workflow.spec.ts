import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

interface WorkflowStep {
  env?: Record<string, string>
  if?: string
  name?: string
  run?: string
  uses?: string
  with?: Record<string, string | number>
  'continue-on-error'?: boolean
  'timeout-minutes'?: number
}

interface WorkflowJob {
  if?: string
  needs?: string | string[]
  outputs?: Record<string, string>
  'timeout-minutes'?: number
  steps?: WorkflowStep[]
  strategy?: {
    matrix?: { os?: string[] }
  }
}

interface Workflow {
  name?: string
  on?: {
    push?: { branches?: string[] }
    pull_request?: { branches?: string[] }
    schedule?: Array<{ cron?: string }>
    workflow_dispatch?: unknown
  }
  jobs: Record<string, WorkflowJob>
}

const root = resolve(import.meta.dirname, '..')

function workflow(name: string): Workflow {
  return YAML.parse(
    readFileSync(resolve(root, `.github/workflows/${name}`), 'utf8'),
  ) as Workflow
}

const devPrWorkflow = workflow('dev-pr-clean-build.yml')
const fullWorkflow = workflow('ci.yml')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  version: string
  scripts: Record<string, string>
}
const cliPackageJson = JSON.parse(
  readFileSync(resolve(root, 'packages/cli/package.json'), 'utf8'),
) as { version: string }

function commands(job: WorkflowJob): string[] {
  return job.steps?.flatMap((step) => step.run ? [step.run] : []) ?? []
}

function step(job: WorkflowJob, name: string): WorkflowStep {
  const found = job.steps?.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`Workflow step is missing: ${name}`)
  return found
}

function expectManualFullValidationGate(job: WorkflowJob): void {
  expect(job.needs).toBe('source-contracts')
  expect(job.if).toContain('!cancelled()')
  expect(job.if).toContain("github.event_name == 'workflow_dispatch'")
  expect(job.if).toContain("needs.source-contracts.result == 'success'")
}

describe('CI workflow authority lanes', () => {
  it('gives dev PRs one clean-build workflow and makes full source validation opt-in', () => {
    expect(devPrWorkflow.name).toBe('Dev PR Clean Build')
    expect(devPrWorkflow.on?.pull_request?.branches).toEqual(['dev'])
    expect(devPrWorkflow.on?.push).toBeUndefined()
    expect(devPrWorkflow.on?.schedule).toBeUndefined()
    expect(Object.keys(devPrWorkflow.jobs)).toEqual(['clean-build'])

    expect(fullWorkflow.name).toBe('Full Source Validation')
    expect(fullWorkflow.on?.pull_request?.branches).toEqual(['master'])
    expect(fullWorkflow.on?.push).toBeUndefined()
    expect(fullWorkflow.on?.schedule).toBeUndefined()
    expect(fullWorkflow.on).toHaveProperty('workflow_dispatch')
    expect(fullWorkflow.jobs['build-and-test']).toBeUndefined()
    expect(fullWorkflow.jobs['post-merge-dev-smoke']).toBeUndefined()
  })

  it('keeps routine dev PR feedback to checkout, install, workflow contracts, and a complete build', () => {
    const cleanBuild = devPrWorkflow.jobs['clean-build']

    expect(commands(cleanBuild)).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm test:contract:workflow',
      'pnpm build',
    ])
    expect(commands(cleanBuild)).not.toContain('npx tsc --noEmit')
    expect(commands(cleanBuild)).not.toContain('pnpm test')
    expect(cleanBuild.strategy).toBeUndefined()
    expect(cleanBuild['timeout-minutes']).toBe(15)
  })

  it('loads the beta classifier from trusted master before running source contracts', () => {
    const sourceContracts = fullWorkflow.jobs['source-contracts']
    const classifier = step(sourceContracts, 'Detect exact beta release preparation')

    expect(classifier['continue-on-error']).toBe(true)
    expect(classifier.if).toBe("github.event_name == 'pull_request'")
    expect(classifier.env?.BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}')
    expect(classifier.run).toContain('git show "${BASE_SHA}:scripts/classify-beta-release-prep.mjs"')
    expect(classifier.run).toContain('--github-output "$GITHUB_OUTPUT"')
    expect(sourceContracts.outputs?.beta_release_prep)
      .toContain("steps.beta-release-prep.outcome == 'success'")
    expect(commands(sourceContracts)).toEqual(expect.arrayContaining([
      'pnpm install --frozen-lockfile',
      'pnpm test:contract:workflow',
      'npx tsc --noEmit',
    ]))
    expect(commands(sourceContracts)).not.toContain('pnpm build')
    expect(commands(sourceContracts)).not.toContain('pnpm test')
  })

  it('runs Linux/macOS full validation only when a maintainer dispatches it', () => {
    const workspaceBuild = fullWorkflow.jobs['workspace-build']
    const tests = fullWorkflow.jobs['hermetic-tests']
    const crossPlatform = fullWorkflow.jobs['cross-platform-test']
    const devSmoke = fullWorkflow.jobs['dev-smoke']

    for (const job of [workspaceBuild, tests, crossPlatform]) {
      expectManualFullValidationGate(job)
    }

    expect(commands(workspaceBuild)).toContain('pnpm build')
    expect(commands(workspaceBuild)).not.toContain('pnpm test')
    expect(commands(tests)).toContain('pnpm test')
    expect(commands(tests)).not.toContain('pnpm build')

    expect(crossPlatform.strategy?.matrix?.os).toEqual(['macos-14'])
    expect(step(crossPlatform, 'Build complete workspace').run).toBe('pnpm build')
    expect(step(crossPlatform, 'Run complete suite').run).toBe('pnpm test')
    expect(crossPlatform['timeout-minutes']).toBe(30)

    expect(devSmoke.strategy).toBeUndefined()
    expect(devSmoke.if).toContain("needs.source-contracts.result == 'success'")
    expect(devSmoke.if).toContain("github.event_name == 'workflow_dispatch'")
    expect(devSmoke.if).toContain("beta_release_prep != 'true'")
    expect(commands(devSmoke)).toContain('pnpm test:system:guardian')
    expect(commands(devSmoke)).toContain('pnpm test:system:dev-stack')
  })

  it('validates the selected ref without a hidden scheduled checkout override', () => {
    for (const job of Object.values(fullWorkflow.jobs)) {
      const checkout = job.steps?.find((candidate) => candidate.uses === 'actions/checkout@v7')
      expect(checkout?.with?.ref).toBeUndefined()
    }
  })

  it('keeps the runtime-visible root and CLI version baselines synchronized', () => {
    expect(packageJson.version).toBe(cliPackageJson.version)
  })
})
