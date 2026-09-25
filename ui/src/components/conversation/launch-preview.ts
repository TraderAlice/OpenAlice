/** One transient handoff from Start to the newly created GUI Session. Never persisted. */
let preview: { workspaceId: string; sessionId: string; prompt: string } | null = null

export function setLaunchPreview(workspaceId: string, sessionId: string, prompt: string) {
  preview = { workspaceId, sessionId, prompt }
}

export function getLaunchPreview(workspaceId: string, sessionId: string): string | null {
  return preview?.workspaceId === workspaceId && preview.sessionId === sessionId ? preview.prompt : null
}

export function clearLaunchPreview(workspaceId: string, sessionId: string) {
  if (getLaunchPreview(workspaceId, sessionId) !== null) preview = null
}
