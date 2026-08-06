// OpenAlice process-local Pi provider projection.
// Loaded explicitly with `pi --extension`; the secret-bearing provider payload
// arrives only through the child environment and is never written to argv or a
// product Session record.

export default function openAliceSessionProvider(pi: {
  registerProvider(providerId: string, provider: Record<string, unknown>): void
}): void {
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
