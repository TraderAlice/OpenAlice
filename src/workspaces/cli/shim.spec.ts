import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, it, expect } from 'vitest'

const execFileAsync = promisify(execFile)

/** Public command launchers share one explicit CommonJS payload. */
const EXPORT_BINARIES = ['alice', 'alice-workspace', 'traderhub', 'alice-uta']
const payloadPath = fileURLToPath(new URL('bin/openalice-cli.cjs', import.meta.url))

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`bin/${name}`, import.meta.url)))

function runCli(name: string, args: string[], env: NodeJS.ProcessEnv) {
  const launcherPath = fileURLToPath(new URL(`bin/${name}`, import.meta.url))
  return process.platform === 'win32'
    ? execFileAsync(process.execPath, [payloadPath, ...args], {
        env: { ...env, OPENALICE_CLI_BIN: name },
        timeout: 5_000,
      })
    : execFileAsync(launcherPath, args, {
        env: {
          ...env,
          // Deliberately remove host command lookup: the packaged launcher must
          // be able to use OpenAlice's Electron Node on a clean machine.
          PATH: '',
          OPENALICE_MANAGED_PI_NODE_PATH: process.execPath,
        },
        timeout: 5_000,
      })
}

describe('CLI launchers and payload', () => {
  it('every POSIX export launcher is byte-identical and selects the managed Node runtime', () => {
    const canonical = read('alice')
    for (const name of EXPORT_BINARIES) {
      expect(read(name).equals(canonical), `${name} has drifted from the alice launcher`).toBe(true)
    }
    const src = canonical.toString('utf8')
    expect(src).toContain('#!/bin/sh')
    expect(src).toContain('OPENALICE_MANAGED_PI_NODE_PATH')
    expect(src).toContain('cygpath -u "$launcher"')
    expect(src).toContain('cygpath -u "$managed_node"')
    expect(src).toContain('cygpath -w "$payload"')
    expect(src).toContain('MSYS2_ENV_CONV_EXCL')
    expect(src).toContain('OPENALICE_TOOL_URL;OPENALICE_TOOL_SOCKET')
    expect(src).toContain('openalice-cli.cjs')
    expect(src).not.toContain('/usr/bin/env node')
  })

  it('the explicit CommonJS payload receives the public export name', () => {
    const src = read('openalice-cli.cjs').toString('utf8')
    expect(src).toContain('OPENALICE_CLI_BIN')
    expect(src).toContain('exportKey') // routes to the per-export gateway path
    expect(src).not.toContain('require(')
    expect(src).toContain("await import('node:http')")
  })

  it('can fetch a manifest with no host Node available', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openalice-cli-shim-'))
    const socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\openalice-cli-shim-${process.pid}-${Date.now()}`
      : join(dir, 'tools.sock')
    const seen: string[] = []
    const server = createServer((req, res) => {
      seen.push(req.url ?? '')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        description: 'test manifest',
        groups: {
          market: {
            search: {
              tool: 'marketSearchForResearch',
              description: 'Search market data',
              inputSchema: { type: 'object', properties: {} },
            },
          },
        },
      }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })
    try {
      const { stdout } = await runCli('alice', [], {
          ...process.env,
          AQ_WS_ID: 'ws1',
          OPENALICE_TOOL_SOCKET: socketPath,
          OPENALICE_TOOL_URL: '/cli',
          OPENALICE_CLI_DEBUG: '1',
      })
      expect(stdout).toContain('[openalice-cli-debug] runtime')
      expect(stdout).toContain('[openalice-cli-debug] socket.response')
      expect(stdout).toContain('OpenAlice CLI')
      expect(stdout).toContain('market')
      expect(seen).toEqual(['/cli/ws1/data/manifest'])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports a wrong CLI endpoint instead of throwing on an HTML manifest response', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openalice-cli-shim-html-'))
    const socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\openalice-cli-shim-html-${process.pid}-${Date.now()}`
      : join(dir, 'tools.sock')
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!DOCTYPE html><html><body>Vite fallback</body></html>')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })
    try {
      await expect(runCli('alice-workspace', ['issue', 'list'], {
          ...process.env,
          AQ_WS_ID: 'ws1',
          OPENALICE_TOOL_SOCKET: socketPath,
          OPENALICE_TOOL_URL: '/cli',
      })).rejects.toMatchObject({
        stderr: expect.stringContaining('invalid OpenAlice CLI manifest'),
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('accepts kebab-case shell flags for camelCase tool schema keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openalice-cli-shim-flags-'))
    const socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\openalice-cli-shim-flags-${process.pid}-${Date.now()}`
      : join(dir, 'tools.sock')
    let invocation: { tool?: string; args?: Record<string, unknown> } | null = null
    const manifest = {
      description: 'test manifest',
      groups: {
        provenance: {
          show: {
            tool: 'provenance_show',
            description: 'Show provenance',
            schema: {
              type: 'object',
              properties: {
                issueId: { type: 'string' },
                accountId: { type: 'string' },
              },
            },
          },
        },
      },
    }
    const server = createServer((req, res) => {
      if (req.method === 'POST') {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          invocation = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }))
        })
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(manifest))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })
    const env = {
      ...process.env,
      AQ_WS_ID: 'ws1',
      OPENALICE_TOOL_SOCKET: socketPath,
      OPENALICE_TOOL_URL: '/cli',
    }
    try {
      const help = await runCli('alice-workspace', ['provenance', 'show', '--help'], env)
      expect(help.stdout).toContain('--issue-id')
      expect(help.stdout).not.toContain('--issueId')

      await runCli('alice-workspace', [
        'provenance', 'show', '--issue-id', 'audit', '--account-id', 'alpaca-paper',
      ], env)
      expect(invocation).toEqual({
        tool: 'provenance_show',
        args: { issueId: 'audit', accountId: 'alpaca-paper' },
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('every Windows `.cmd` twin derives its export and selects the managed Node runtime', () => {
    const canonical = read('alice.cmd')
    for (const name of EXPORT_BINARIES) {
      expect(read(`${name}.cmd`).equals(canonical), `${name}.cmd has drifted`).toBe(true)
    }
    const cmd = canonical.toString('utf8')
    expect(cmd).toContain('OPENALICE_CLI_BIN=%~n0')
    expect(cmd).toContain('OPENALICE_MANAGED_PI_NODE_PATH')
    expect(cmd).toContain('openalice-cli.cjs')
    expect(cmd).toContain('%*')
  })
})
