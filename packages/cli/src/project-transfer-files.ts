/** Deterministic transforms applied before portable bytes enter the SSH stream. */
import { join } from 'node:path'

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
      return transformJson(input.bytes, (value) => ({ ...recordValue(value), credentials: {} }))
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
        return { ...workspace, dir: join(destinationHome, 'workspaces', 'workspaces', id) }
      })
    : []
  return { ...root, workspaces }
}

function rewriteWorkspaceCatalog(value: unknown, destinationHome: string): unknown {
  const root = recordValue(value)
  const workspaces = Array.isArray(root['workspaces'])
    ? root['workspaces'].map((entry) => {
        const workspace = recordValue(entry)
        const id = requireSafeId(workspace['id'], 'Workspace Catalog')
        return {
          ...workspace,
          activeDir: join(destinationHome, 'workspaces', 'workspaces', id),
          ...(typeof workspace['departedDir'] === 'string'
            ? { departedDir: join(destinationHome, 'workspaces', 'departed-workspaces', id) }
            : {}),
        }
      })
    : []
  return { ...root, workspaces }
}

function rewriteIssueOwner(value: string): string {
  const match = /^(---\s*\n)([\s\S]*?)(\n---(?:\s*\n|$))/u.exec(value)
  if (!match?.[1] || match[2] === undefined || !match[3]) {
    throw transferTransformError('Scheduled Issue frontmatter changed after planning.')
  }
  const rewritten = match[2].replace(
    /^(assignee\s*:\s*)["']?@resume-[^\s"']+["']?(\s*)$/mu,
    '$1"@new-then-resume"$2',
  )
  if (rewritten === match[2]) {
    throw transferTransformError('Scheduled Issue exact owner changed after planning.')
  }
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
