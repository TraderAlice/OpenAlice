import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

interface WorkflowStep {
  name?: string
  if?: string
  run?: string
  uses?: string
  'continue-on-error'?: boolean
  env?: Record<string, string>
}

interface WorkflowJob {
  if?: string
  needs?: string | string[]
  outputs?: Record<string, string>
  steps?: WorkflowStep[]
}

interface Workflow {
  on?: {
    pull_request?: { branches?: string[] }
  }
  jobs: Record<string, WorkflowJob>
}

const root = resolve(import.meta.dirname, '..')

function workflow(name: string): Workflow {
  return YAML.parse(readFileSync(resolve(root, `.github/workflows/${name}`), 'utf8')) as Workflow
}

function step(job: WorkflowJob, name: string): WorkflowStep {
  const found = job.steps?.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`Workflow step is missing: ${name}`)
  return found
}

function expectTrustedClassifier(job: WorkflowJob): void {
  const classifier = step(job, 'Detect exact beta release preparation')
  expect(classifier['continue-on-error']).toBe(true)
  expect(classifier.if).toBe("github.event_name == 'pull_request'")
  expect(classifier.env?.BASE_SHA).toBe('${{ github.event.pull_request.base.sha }}')
  expect(classifier.run).toContain('git show "${BASE_SHA}:scripts/classify-beta-release-prep.mjs"')
  expect(classifier.run).toContain('--github-output "$GITHUB_OUTPUT"')
}

function expectOutcomeGatedOutput(job: WorkflowJob): void {
  expect(job.outputs?.beta_release_prep).toContain("steps.beta-release-prep.outcome == 'success'")
  expect(job.outputs?.beta_release_prep).toContain("|| 'false'")
}

describe('exact beta release-preparation workflow lane', () => {
  it('keeps contracts and typecheck while skipping root build, test, and host matrices', () => {
    const jobs = workflow('ci.yml').jobs
    expectTrustedClassifier(jobs['change-scope'])
    expectOutcomeGatedOutput(jobs['change-scope'])
    expect(step(jobs.build, 'Verify CI workflow contracts').run)
      .toBe('pnpm test:workflow-contracts')
    expect(step(jobs.build, 'Typecheck root workspace').run)
      .toBe('npx tsc --noEmit')
    expect(jobs.build.needs).toBe('change-scope')
    expect(jobs.build.if).toContain('!cancelled()')
    expect(step(jobs.build, 'Build complete workspace').if)
      .toContain("needs.change-scope.result != 'success'")
    expect(step(jobs.build, 'Build complete workspace').if)
      .toContain("beta_release_prep != 'true'")
    for (const name of ['test', 'cross-platform-test', 'dev-smoke']) {
      expect(jobs[name].needs).toBe('change-scope')
      expect(jobs[name].if).toContain('!cancelled()')
      expect(jobs[name].if).toContain("needs.change-scope.result != 'success'")
      expect(jobs[name].if).toContain("beta_release_prep != 'true'")
    }
    const aggregate = jobs['build-and-test']
    expect(aggregate.needs).toEqual(['change-scope', 'build', 'test'])
    expect(aggregate.if).toContain('always()')
    const gate = step(aggregate, 'Require successful build and test lanes').run ?? ''
    expect(gate).toContain('[[ "$BETA_RELEASE_PREP" == "true" ]]')
    expect(gate).toContain('[[ "$BUILD_RESULT" == "success" ]]')
    expect(gate).toContain('[[ "$TEST_RESULT" == "skipped" ]]')
  })

  it('keeps desktop classification cheap while central CI owns contracts and typecheck', () => {
    const desktop = workflow('desktop-package-smoke.yml')
    const jobs = desktop.jobs
    expect(desktop.on?.pull_request?.branches).toEqual(['master'])
    expectTrustedClassifier(jobs.preflight)
    expectOutcomeGatedOutput(jobs.preflight)
    for (const name of [
      'Install dependencies',
      'Verify CI workflow contracts',
      'Typecheck root workspace',
    ]) {
      const candidate = step(jobs.preflight, name)
      expect(candidate.if).toContain("steps.beta-release-prep.outcome != 'success'")
      expect(candidate.if).toContain("beta_release_prep != 'true'")
    }
    expect(jobs['broker-packs-windows'].if).toContain("beta_release_prep != 'true'")
    expect(jobs.package.if).toContain("beta_release_prep != 'true'")
  })

  it('skips CLI PR acceptance without changing the dev publication chain', () => {
    const cli = workflow('cli-installer-smoke.yml')
    const jobs = cli.jobs
    const scope = jobs['release-prep-scope']
    expect(cli.on?.pull_request?.branches).toEqual(['master'])
    expectTrustedClassifier(scope)
    expectOutcomeGatedOutput(scope)
    expect(scope.if).toBe("github.event_name != 'push'")
    for (const name of ['bun-cli-feasibility', 'checkout-install', 'checkout-remote']) {
      expect(jobs[name].needs).toBe('release-prep-scope')
      expect(jobs[name].if).toContain('!cancelled()')
      expect(jobs[name].if).toContain("needs.release-prep-scope.result != 'success'")
      expect(jobs[name].if).toContain("beta_release_prep != 'true'")
    }
    expect(jobs['bun-cli-feasibility'].if).toContain("github.base_ref == 'master'")
    expect(jobs['checkout-remote'].if).toContain("github.base_ref == 'master'")
    expect(jobs['checkout-install'].if).not.toContain("github.base_ref == 'master'")
    expect(jobs['build-dev-cli'].if).toBe("github.event_name == 'push'")
    expect(jobs['build-dev-cli'].needs).toBeUndefined()
    expect(jobs['publish-dev-cli'].needs).toBe('build-dev-cli')
  })

  it('keeps the Docker check green but omits setup, build, and smoke on an exact match', () => {
    const docker = workflow('docker-smoke.yml')
    const smoke = docker.jobs.smoke
    expect(docker.on?.pull_request?.branches).toEqual(['master'])
    expectTrustedClassifier(smoke)
    const expensive = smoke.steps?.filter((candidate) => [
      'actions/setup-node@v7',
      'docker/setup-buildx-action@v3',
      'docker/build-push-action@v6',
    ].includes(candidate.uses ?? '') || candidate.name === 'Exercise Guardian, Workspace PTY, and CLI gateway') ?? []
    expect(expensive).toHaveLength(4)
    for (const candidate of expensive) {
      expect(candidate.if).toContain("steps.beta-release-prep.outcome != 'success'")
      expect(candidate.if).toContain("beta_release_prep != 'true'")
    }
    expect(step(smoke, 'Build server image').if).toContain("beta_release_prep != 'true'")
    expect(step(smoke, 'Exercise Guardian, Workspace PTY, and CLI gateway').if)
      .toContain("beta_release_prep != 'true'")
  })

  it('never lets the classifier bypass final release candidates or publication', () => {
    const releaseSource = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')
    expect(releaseSource).not.toContain('classify-beta-release-prep')
    expect(releaseSource).not.toContain('beta_release_prep')
  })
})
