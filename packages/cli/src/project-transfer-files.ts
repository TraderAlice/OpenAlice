/** Deterministic transforms applied before portable bytes enter the SSH stream. */
import { posix } from 'node:path'
import { parseDocument } from 'yaml'

import type { ProjectTransferTransform } from './project-transfer.ts'

export function transformProjectTransferFile(input: {
  path: string
  transform: ProjectTransferTransform
  bytes: Buffer
  destinationHome: string
}): Buffer {
  switch (input.transform) {
    case 'workspace-registry-paths':
      return transformJson(input.bytes, (value) => rewriteWorkspaceRegistry(value, input.destinationHome))
    case 'workspace-catalog-paths':
      return transformJson(input.bytes, (value) => rewriteWorkspaceCatalog(value, input.destinationHome))
    case 'strip-ai-credentials':
      return transformJson(input.bytes, (value) => ({
        ...recordValue(value),
        apiKeys: {},
        credentials: {},
      }))
    case 'strip-market-provider-keys':
      return transformJson(input.bytes, (value) => ({ ...recordValue(value), providerKeys: {} }))
    case 'rewrite-issue-owner':
      return Buffer.from(rewriteIssueOwner(input.bytes.toString('utf8')), 'utf8')
  }
}

function rewriteWorkspaceRegistry(value: unknown, destinationHome: string): unknown {
  const root = recordValue(value)
  const workspaces = Array.isArray(root['workspaces'])
    ? root['workspaces'].map((entry) => {
        const workspace = recordValue(entry)
        const id = requireSafeId(workspace['id'], 'Workspace')
        return { ...workspace, dir: posix.join(destinationHome, 'workspaces', 'workspaces', id) }
      })
    : []
  return { ...root, workspaces }
}

function rewriteWorkspaceCatalog(value: unknown, destinationHome: string): unknown {
  const root = recordValue(value)
  const workspaces = Array.isArray(root['workspaces'])
    ? root['workspaces'].flatMap((entry) => {
        const workspace = recordValue(entry)
        // Pre-#662 could import Pi's redirected agent home as a departed
        // pseudo-Workspace. It is native runtime state, not a user Workspace.
        if (
          workspace['id'] === '.pi-agent'
          && workspace['legacyImported'] === true
          && workspace['lifecycle'] === 'departed'
        ) return []
        const id = requireSafeId(workspace['id'], 'Workspace Catalog')
        return [{
          ...workspace,
          activeDir: posix.join(destinationHome, 'workspaces', 'workspaces', id),
          ...(typeof workspace['departedDir'] === 'string'
            ? { departedDir: posix.join(destinationHome, 'workspaces', 'departed-workspaces', id) }
            : {}),
        }]
      })
    : []
  return { ...root, workspaces }
}

function rewriteIssueOwner(value: string): string {
  const match = /^(---\s*\n)([\s\S]*?)(\n---(?:\s*\n|$))/u.exec(value)
  if (!match?.[1] || match[2] === undefined || !match[3]) {
    throw transferTransformError('Scheduled Issue frontmatter changed after planning.')
  }
  const document = parseDocument(match[2])
  if (document.errors.length > 0 || document.get('assignee')?.toString().startsWith('@resume-') !== true) {
    throw transferTransformError('Scheduled Issue exact owner changed after planning.')
  }
  document.set('assignee', '@new-then-resume')
  const rewritten = document.toString().replace(/\n$/u, '')
  return `${match[1]}${rewritten}${match[3]}${value.slice(match[0].length)}`
}

function transformJson(bytes: Buffer, operation: (value: unknown) => unknown): Buffer {
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown
  } catch (error: unknown) {
    throw transferTransformError('Portable configuration changed into invalid JSON after planning.', error)
  }
  return Buffer.from(`${JSON.stringify(operation(value), null, 2)}\n`, 'utf8')
}

function requireSafeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/iu.test(value)) {
    throw transferTransformError(`${label} contains an unsafe id.`)
  }
  return value
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function transferTransformError(message: string, cause?: unknown): Error & { code: string; exitCode: number } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
    code: 'ETRANSFORM',
    exitCode: 1,
  })
}
