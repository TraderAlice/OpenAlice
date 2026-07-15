/** Shared UI contract for Pi/OpenCode Workspace context limits. */
export const DEFAULT_WORKSPACE_CONTEXT_WINDOW = 256_000

export const WORKSPACE_CONTEXT_WINDOW_OPTIONS = [
  { value: 128_000, label: '128K' },
  { value: 256_000, label: '256K — recommended' },
  { value: 512_000, label: '512K' },
  { value: 1_000_000, label: '1M' },
] as const

export function normalizeWorkspaceContextWindow(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_WORKSPACE_CONTEXT_WINDOW
}

export function isPresetWorkspaceContextWindow(value: number): boolean {
  return WORKSPACE_CONTEXT_WINDOW_OPTIONS.some((option) => option.value === value)
}
