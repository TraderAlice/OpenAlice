import { readFileSync } from 'node:fs'

export function inspectWorkspaceAcceptanceReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('Workspace acceptance receipt must be a JSON object')
  }
  const checks = receipt.checks
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) {
    throw new Error('Workspace acceptance receipt is missing checks')
  }
  const incompleteChecks = Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name)
  const error = typeof receipt.error === 'string' && receipt.error.trim()
    ? receipt.error.trim()
    : null
  return { error, incompleteChecks }
}

export function readWorkspaceAcceptanceReceipt(receiptPath) {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
  return { receipt, ...inspectWorkspaceAcceptanceReceipt(receipt) }
}

export function formatWorkspaceAcceptanceFailure({ error, incompleteChecks }) {
  const details = []
  if (error) details.push(`error: ${error}`)
  if (incompleteChecks.length > 0) {
    details.push(`incomplete checks: ${incompleteChecks.join(', ')}`)
  }
  return details.join('; ') || 'receipt did not report a failure'
}
