/** Shared fetch headers for JSON requests. */
export const headers = { 'Content-Type': 'application/json' }

/** Fetch helper that throws on non-OK responses. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (res.status === 401) {
    // Global "session died / never had one" signal. AuthContext listens
    // and flips back to the login page. Throw after dispatching so the
    // caller's promise rejects rather than silently resolving.
    window.dispatchEvent(new CustomEvent('app:unauthorized'))
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.message || err.error || res.statusText)
  }
  return res.json()
}
