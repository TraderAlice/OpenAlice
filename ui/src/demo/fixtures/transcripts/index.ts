import type { Transcript } from '../../types'
import { DEMO_WORKSPACE_ID } from '../workspaces'
import { welcomeTranscript } from './welcome'

/**
 * Map workspace id → transcript. When the demo terminal renders for a
 * given session, it looks up the workspace and plays the matching
 * transcript if registered. No entry → falls back to DemoTerminalStub.
 *
 * Stage 2 ships exactly one hand-crafted placeholder. PR-3 wires in a
 * real recorded session.
 */
export const transcriptsByWorkspace: Record<string, Transcript> = {
  [DEMO_WORKSPACE_ID]: welcomeTranscript,
}
