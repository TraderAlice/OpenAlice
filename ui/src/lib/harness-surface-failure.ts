export function harnessSurfaceFailureKind(logs: string): 'missing-dependencies' | 'generic' {
  return /node_modules\s+missing|command not found|spawn\s+ENOENT/i.test(logs)
    ? 'missing-dependencies'
    : 'generic'
}
