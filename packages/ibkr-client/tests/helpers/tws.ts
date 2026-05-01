/**
 * Helper for e2e tests — checks if TWS/IB Gateway is reachable.
 * If not, tests in the suite are skipped instead of failing.
 */

import net from 'node:net'

const TWS_HOST = process.env.TWS_HOST ?? '127.0.0.1'
const TWS_PORT = parseInt(process.env.TWS_PORT ?? '7497', 10)

export { TWS_HOST, TWS_PORT }

export async function isTwsAvailable(
  host = TWS_HOST,
  port = TWS_PORT,
  timeoutMs = 2000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)

    socket.connect(port, host, () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })

    socket.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}
