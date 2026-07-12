import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  buildDockerRuntimeSmokePlan,
  parsePublishedPort,
  redactDockerLogs,
  stripTerminalControl,
} from './docker-runtime-smoke-lib.mjs'

describe('Docker runtime smoke plan', () => {
  it('owns a unique image for the default build-and-smoke path', () => {
    const plan = buildDockerRuntimeSmokePlan([], { randomUUID: () => 'ABCDEF12-3456-7890-abcd-ef1234567890' })

    expect(plan.errors).toEqual([])
    expect(plan.options).toMatchObject({
      image: 'openalice:docker-smoke-abcdef123456',
      ownsImage: true,
      skipBuild: false,
      containerName: 'openalice-docker-smoke-abcdef123456',
    })
  })

  it('requires a caller-owned image when skipping the build', () => {
    expect(buildDockerRuntimeSmokePlan(['--skip-build']).errors).toContain(
      '[docker-smoke] --skip-build requires --image <tag>',
    )
    const plan = buildDockerRuntimeSmokePlan(['--skip-build', '--image', 'openalice:ci'])
    expect(plan.errors).toEqual([])
    expect(plan.options).toMatchObject({ image: 'openalice:ci', ownsImage: false, skipBuild: true })
  })

  it('makes real AI conversation opt-in and never keeps its secret volume', () => {
    const plan = buildDockerRuntimeSmokePlan(['--ai-credential', 'custom-1'])
    expect(plan.errors).toEqual([])
    expect(plan.options).toMatchObject({ aiCredentialSlug: 'custom-1', aiAgent: 'claude' })

    expect(buildDockerRuntimeSmokePlan(['--ai-credential', 'custom-1', '--keep']).errors).toContain(
      '[docker-smoke] --keep is disabled for credentialed smoke runs so the secret volume is always removed',
    )
    expect(buildDockerRuntimeSmokePlan(['--ai-agent', 'codex']).errors).toContain(
      '[docker-smoke] --ai-agent requires --ai-credential <slug>',
    )
    expect(buildDockerRuntimeSmokePlan(['--ai-credential', 'custom-1', '--ai-agent', 'ghost']).errors).toContain(
      '[docker-smoke] --ai-agent must be claude, codex, opencode, or pi',
    )
  })

  it('parses Docker port output and terminal output deterministically', () => {
    expect(parsePublishedPort('127.0.0.1:49173\n')).toBe(49173)
    expect(parsePublishedPort('[::1]:49174')).toBe(49174)
    expect(() => parsePublishedPort('')).toThrow('did not publish')
    expect(stripTerminalControl('\u001b[32mOpenAlice\u001b[0m\r\n')).toBe('OpenAlice\n')
  })

  it('redacts the ephemeral first-run token and runtime credentials from failure logs', () => {
    const logs = [
      'First-run admin token (save this):',
      '',
      '      abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
      'engine started',
    ].join('\n')
    const apiKey = 'secret-runtime-key'
    const redacted = redactDockerLogs(`${logs}\nprovider rejected ${apiKey}`, [apiKey])
    expect(redacted).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(redacted).not.toContain(apiKey)
    expect(redacted).toContain('[ephemeral admin token redacted]')
    expect(redacted).toContain('[runtime credential redacted]')
  })
})

describe('Dockerfile runtime contract', () => {
  const root = resolve(import.meta.dirname, '..')
  const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8')
  const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8')
  const compose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')
  const workflow = readFileSync(resolve(root, '.github/workflows/docker-smoke.yml'), 'utf8')
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { packageManager: string }

  it('keeps the image pnpm version aligned with packageManager', () => {
    const pnpmVersion = packageJson.packageManager.replace(/^pnpm@/, '')
    expect(dockerfile).toContain(`corepack prepare pnpm@${pnpmVersion} --activate`)
  })

  it('installs the complete sibling-based Workspace CLI set for login shells', () => {
    expect(dockerfile).toContain('COPY --from=build /src/src/workspaces/cli/bin')
    expect(dockerfile).toContain('/usr/local/bin/openalice-cli.cjs')
    for (const command of ['alice', 'alice-uta', 'alice-workspace', 'traderhub']) {
      expect(dockerfile).toContain(`/usr/local/bin/${command}`)
    }
    expect(dockerfile).not.toMatch(/ln -s[^\n]*\/usr\/local\/bin\/(alice|traderhub)/)
  })

  it('pins and verifies all four agent runtimes and exposes a healthcheck', () => {
    for (const name of ['CLAUDE_CODE', 'CODEX', 'OPENCODE', 'PI']) {
      expect(dockerfile).toMatch(new RegExp(`ARG ${name}_VERSION=\\d+\\.\\d+\\.\\d+`))
    }
    for (const command of ['claude', 'codex', 'opencode', 'pi']) {
      expect(dockerfile).toContain(`&& ${command} --version`)
    }
    expect(dockerfile).toContain('HEALTHCHECK ')
    expect(dockerfile).toContain('/api/version')
  })

  it('keeps the server build desktop-free and the remote lifecycle bounded', () => {
    expect(dockerignore).toMatch(/^apps\/desktop$/m)
    expect(compose).toContain('stop_grace_period: 30s')
    expect(compose).toContain('max-size: "10m"')
    expect(compose).toContain('max-file: "3"')
  })

  it('runs the real Workspace smoke in Docker CI', () => {
    expect(workflow).toContain('docker/build-push-action@v6')
    expect(workflow).toContain('docker-runtime-smoke.mjs --skip-build --image openalice:ci')
    expect(workflow).toContain('OPENALICE_DOCKER_SMOKE_LOG_FILE')
  })
})
