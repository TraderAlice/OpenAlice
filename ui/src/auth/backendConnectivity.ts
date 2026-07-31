/**
 * Observe failed OpenAlice API requests without confusing a single subsystem
 * failure with an unavailable Alice process.
 *
 * A failed request only asks AuthProvider to run its independent
 * `/api/auth/status` probe. AuthProvider remains the authority that decides
 * whether the whole backend is offline.
 */

export const BACKEND_PROBE_REQUESTED_EVENT = 'app:backend-probe-requested'

type FetchDispatch = () => void

function requestUrl(input: RequestInfo | URL, baseUrl: string): URL | null {
  try {
    if (input instanceof Request) return new URL(input.url, baseUrl)
    return new URL(input instanceof URL ? input.href : input, baseUrl)
  } catch {
    return null
  }
}

function isSameOpenAliceApi(url: URL | null, baseUrl: string): boolean {
  if (!url || !url.pathname.startsWith('/api/')) return false
  const base = new URL(baseUrl)
  return url.protocol === base.protocol && url.host === base.host
}

function isAuthStatus(url: URL | null): boolean {
  return url?.pathname === '/api/auth/status'
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function createBackendObservedFetch(
  fetchImpl: typeof fetch,
  requestProbe: FetchDispatch,
  baseUrl: string,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input, baseUrl)
    const observe = isSameOpenAliceApi(url, baseUrl) && !isAuthStatus(url)
    try {
      const response = await fetchImpl(input, init)
      // A route-level 5xx may be local to one subsystem. Ask the independent
      // core probe to classify it instead of declaring the backend offline.
      if (observe && response.status >= 500) requestProbe()
      return response
    } catch (error) {
      if (observe && !isAbort(error)) requestProbe()
      throw error
    }
  }
}

let installed = false

export function installBackendRequestObserver(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const nativeFetch = window.fetch.bind(window)
  window.fetch = createBackendObservedFetch(
    nativeFetch,
    () => window.dispatchEvent(new Event(BACKEND_PROBE_REQUESTED_EVENT)),
    window.location.href,
  )
}
