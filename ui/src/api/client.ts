/** Shared fetch headers for JSON requests. */
export const headers = { 'Content-Type': 'application/json' }

/** Fetch helper that throws on non-OK responses. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || res.statusText)
  }
  return res.json()
}
