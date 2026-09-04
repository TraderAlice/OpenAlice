import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

describe('Windows preview delivery boundary', () => {
  it('is manually dispatched, independent per architecture, and cannot publish stable aliases', () => {
    const workflow = YAML.parse(read('.github/workflows/windows-cli-preview.yml'))
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch', 'workflow_call'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    const job = workflow.jobs.preview
    expect(job.needs).toBeUndefined()
    expect(job.strategy['fail-fast']).toBe(false)
    expect(job.strategy.matrix.include).toEqual([
      { os: 'windows-latest', arch: 'x64' }, { os: 'windows-11-arm', arch: 'arm64' },
    ])
    const steps = job.steps as Array<{ name?: string; run?: string }>
    expect(steps.findIndex(s => s.name === 'Preserve complete candidate for reproduction'))
      .toBeLessThan(steps.findIndex(s => s.name === 'Install and start the packaged Runtime'))
    expect(steps.some(s => /pnpm test(?:\s|$)|npm publish|electron:pack/.test(s.run ?? ''))).toBe(false)
  })

  it('the registered installer workflow can dispatch previews without its normal manual gates or dev activation', () => {
    const workflow = YAML.parse(read('.github/workflows/cli-installer-smoke.yml'))
    expect(workflow.on.workflow_dispatch.inputs.windows_preview.default).toBe(false)
    expect(workflow.jobs['windows-preview'].uses).toBe('./.github/workflows/windows-cli-preview.yml')
    for (const job of ['release-prep-scope', 'bun-cli-feasibility', 'checkout-install', 'checkout-remote', 'dev-channel-install']) {
      expect(workflow.jobs[job].if).toContain('!inputs.windows_preview')
    }
    for (const job of ['build-dev-cli-neutral', 'build-dev-cli', 'publish-dev-cli-candidate', 'activate-dev-cli']) {
      expect(workflow.jobs[job].if).toBe("github.event_name == 'push'")
    }
  })

  it('keeps the installer opt-in, checksum-bound, non-destructive, and independent of agent installation', () => {
    const source = read('install-preview.ps1')
    expect(source).toContain('Archive SHA-256 mismatch')
    expect(source).toContain('Destination already exists')
    expect(source).toContain('[IO.Directory]::Move($release, $destination)')
    expect(source).toContain('if ($Plan) { return }')
    expect(source).not.toMatch(/Set-ExecutionPolicy|SetEnvironmentVariable|npm install|Invoke-Expression/)
    expect(source).toContain('Remove-Item -LiteralPath $stage -Recurse -Force')
    expect(source).not.toContain('Remove-Item -LiteralPath $destination')
  })
})
