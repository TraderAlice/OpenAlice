/** Match the News renderer's local-demo support; remote URLs never carry credentials. */
export function safeNotificationImage(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value
  try {
    const url = new URL(value)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) return url.href
  } catch { /* Feed media is optional. */ }
  return undefined
}
