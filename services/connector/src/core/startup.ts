export const CONNECTOR_ADAPTER_STARTUP_TIMEOUT_MS = 30_000

/** Bound third-party SDK bootstrap even when the SDK ignores AbortSignal. */
export async function withStartupDeadline<T>(
  label: string,
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    return await raceWithAbort(Promise.resolve().then(() => task(signal)), signal)
  } catch (error) {
    if (!signal.aborted) throw error
    throw new Error(
      `${label} startup timed out after ${Math.ceil(timeoutMs / 1_000)} seconds`,
      { cause: error },
    )
  }
}

function raceWithAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => reject(signal.reason)
    signal.addEventListener('abort', aborted, { once: true })
    void task.then(
      (value) => {
        signal.removeEventListener('abort', aborted)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', aborted)
        reject(error)
      },
    )
  })
}
