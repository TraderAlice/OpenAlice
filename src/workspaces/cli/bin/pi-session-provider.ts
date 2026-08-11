// OpenAlice process-local Pi integration.
// Loaded explicitly with `pi --extension`; the optional secret-bearing provider
// payload arrives only through the child environment and is never written to
// argv or a product Session record. Interactive launches also publish native
// Agent activity through a private terminal OSC frame consumed by OpenAlice.

const ACTIVITY_OSC = 6973

type PiExtension = {
  registerProvider(providerId: string, provider: Record<string, unknown>): void
  on(event: 'agent_start' | 'agent_settled', handler: () => void | Promise<void>): void
}

function emitActivity(phase: 'working' | 'waiting'): void {
  const sessionId = process.env['AQ_SESSION_ID']
  if (!sessionId || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return
  process.stdout.write(
    `\x1b]${ACTIVITY_OSC};openalice-session-activity;v=1;session=${sessionId};phase=${phase}\x1b\\`,
  )
}

export default function openAliceSessionProvider(pi: PiExtension): void {
  emitActivity('waiting')
  pi.on('agent_start', () => emitActivity('working'))
  pi.on('agent_settled', () => emitActivity('waiting'))

  const raw = process.env['OPENALICE_PI_SESSION_PROVIDER']
  if (!raw) return
  const value = JSON.parse(raw) as Record<string, unknown>
  const providerId = value['providerId']
  const provider = value['provider']
  if (
    typeof providerId !== 'string'
    || !provider
    || typeof provider !== 'object'
    || Array.isArray(provider)
  ) {
    throw new Error('Invalid OpenAlice Pi Session provider projection')
  }
  const models = Array.isArray((provider as Record<string, unknown>)['models'])
    ? (provider as Record<string, unknown>)['models'] as Array<Record<string, unknown>>
    : undefined
  const registeredProvider = models
    ? {
        ...(provider as Record<string, unknown>),
        models: models.map((model) => ({
          name: model['id'],
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
          ...model,
        })),
      }
    : provider as Record<string, unknown>
  pi.registerProvider(providerId, registeredProvider)
}
