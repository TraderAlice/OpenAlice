/**
 * Transient Agent work state for one live interactive Session.
 *
 * This is deliberately separate from SessionRecord.state: a native TUI can
 * stay alive and resumable while the Agent is waiting for the next prompt.
 * Activity is not persisted; adapter hooks publish a fresh snapshot whenever
 * the native process starts or a turn changes state.
 */
export const SESSION_ACTIVITY_OSC = 6973
export const SESSION_ACTIVITY_PROTOCOL_VERSION = 1

export type SessionAgentActivityPhase =
  | 'starting'
  | 'working'
  | 'waiting'
  | 'unavailable'
  | 'failed'
  | 'stopped'

export interface SessionAgentActivity {
  readonly phase: SessionAgentActivityPhase
  readonly observedAt: number
}

type WebPiActivityPhase =
  | 'starting'
  | 'idle'
  | 'working'
  | 'compacting'
  | 'retrying'
  | 'stopped'
  | 'failed'

/**
 * Project the shared public activity snapshot from the two interactive
 * transports. Terminal sessions own an explicit native snapshot; WebPi owns
 * an RPC state machine; a record with no live process is stopped. Keeping this
 * mapping here prevents REST surfaces from drifting on lifecycle semantics.
 */
export function projectSessionAgentActivity(input: {
  readonly terminal?: SessionAgentActivity | null
  readonly browser?: {
    readonly phase: WebPiActivityPhase
    readonly startedAt: number
  } | null
  readonly lastActiveAt: string
}): SessionAgentActivity {
  if (input.terminal) return input.terminal
  if (input.browser) {
    const phase: SessionAgentActivityPhase =
      input.browser.phase === 'idle' ? 'waiting'
      : input.browser.phase === 'failed' ? 'failed'
      : input.browser.phase === 'stopped' ? 'stopped'
      : input.browser.phase === 'starting' ? 'starting'
      : 'working'
    return { phase, observedAt: input.browser.startedAt }
  }
  const fallbackObservedAt = Date.parse(input.lastActiveAt)
  return {
    phase: 'stopped',
    observedAt: Number.isFinite(fallbackObservedAt) ? fallbackObservedAt : 0,
  }
}

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const FRAME_PREFIX = 'openalice-session-activity'
const PHASES = new Set<SessionAgentActivityPhase>([
  'starting',
  'working',
  'waiting',
  'unavailable',
  'failed',
  'stopped',
])

/** Encode a private OSC frame that is invisible to ordinary terminal output. */
export function encodeSessionActivityOsc(
  sessionId: string,
  phase: SessionAgentActivityPhase,
): string {
  if (!SESSION_ID_RE.test(sessionId)) throw new Error('invalid Session activity id')
  const payload = [
    FRAME_PREFIX,
    `v=${SESSION_ACTIVITY_PROTOCOL_VERSION}`,
    `session=${sessionId}`,
    `phase=${phase}`,
  ].join(';')
  return `\x1b]${SESSION_ACTIVITY_OSC};${payload}\x1b\\`
}

/**
 * Validate an adapter-authored OSC payload for the PTY that emitted it.
 * Malformed, stale, cross-Session, or future-version frames are ignored.
 */
export function parseSessionActivityOsc(
  payload: string,
  expectedSessionId: string,
): SessionAgentActivityPhase | null {
  if (!SESSION_ID_RE.test(expectedSessionId) || payload.length > 512) return null
  const [prefix, ...parts] = payload.split(';')
  if (prefix !== FRAME_PREFIX) return null
  const fields = new Map<string, string>()
  for (const part of parts) {
    const separator = part.indexOf('=')
    if (separator <= 0 || separator === part.length - 1) return null
    const key = part.slice(0, separator)
    if (fields.has(key)) return null
    fields.set(key, part.slice(separator + 1))
  }
  if (fields.size !== 3) return null
  if (fields.get('v') !== String(SESSION_ACTIVITY_PROTOCOL_VERSION)) return null
  if (fields.get('session') !== expectedSessionId) return null
  const phase = fields.get('phase')
  return phase && PHASES.has(phase as SessionAgentActivityPhase)
    ? phase as SessionAgentActivityPhase
    : null
}
