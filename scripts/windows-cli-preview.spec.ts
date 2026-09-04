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
    expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read' })
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

  it('replays existing bytes without dependency setup, compilation, or candidate re-upload', () => {
    const workflow = YAML.parse(read('.github/workflows/windows-cli-preview.yml'))
    const steps = workflow.jobs.preview.steps as Array<{ uses?: string; name?: string; run?: string; if?: string; with?: Record<string, unknown> }>
    for (const step of steps.filter(s => s.uses === 'pnpm/action-setup@v6' || s.uses === 'actions/setup-node@v7' ||
      s.run?.startsWith('pnpm ') || s.run?.includes('build-windows-cli-preview.ts') ||
      s.name === 'Preserve complete candidate for reproduction')) {
      expect(step.if?.split(' && ')[0]).toBe("inputs.candidate_run == ''")
    }
    const download = steps.find(s => s.uses === 'actions/download-artifact@v5')!
    expect(download.if).toBe("inputs.candidate_run != ''")
    expect(download.with?.['merge-multiple']).toBe(false)
    expect(download.with?.['run-id']).toBe('${{ inputs.candidate_run }}')
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

  it('joins ordinary dev and release publication without adding source-test jobs', () => {
    const dev = YAML.parse(read('.github/workflows/cli-installer-smoke.yml'))
    const release = YAML.parse(read('.github/workflows/release.yml'))
    expect(dev.jobs['build-dev-cli-windows'].with).toMatchObject({ channel_build: true, neutral_inputs: true })
    expect(dev.jobs['build-dev-cli-windows'].with.native_acceptance).toBe(false)
    expect(dev.jobs['publish-dev-cli-candidate'].needs).toContain('build-dev-cli-windows')
    expect(release.jobs['build-cli-windows'].with.channel_build).toBe(true)
    expect(release.jobs['build-cli-windows'].with.native_acceptance).toContain("channel == 'stable'")
    expect(release.jobs['publish-release'].needs).toContain('build-cli-windows')
    expect(release.jobs['build-cli-package-channels'].needs).toContain('build-cli-windows')
    expect(read('install.ps1')).not.toMatch(/Set-ExecutionPolicy|npm install|Invoke-Expression/)
    expect(read('install.ps1')).toContain('[IO.File]::Replace($temporary, $path, $null)')
  })
})
