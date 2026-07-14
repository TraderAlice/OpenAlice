#!/usr/bin/env node
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve, sep } from 'node:path'

const root = '/fixture'
const host = '127.0.0.1'
const port = 18080

const server = createServer(async (request, response) => {
  const method = request.method ?? 'GET'
  const pathname = decodeURIComponent(new URL(request.url ?? '/', `http://${host}:${port}`).pathname)
  console.log(`${method} ${pathname}`)

  if (method !== 'GET') {
    response.writeHead(405).end('method not allowed\n')
    return
  }

  const candidate = resolve(root, `.${pathname}`)
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end('forbidden\n')
    return
  }

  try {
    const details = await stat(candidate)
    if (!details.isFile()) throw new Error('not a file')
    response.writeHead(200, { 'content-length': details.size })
    createReadStream(candidate).pipe(response)
  } catch {
    response.writeHead(404).end('not found\n')
  }
})

server.listen(port, host, () => {
  console.log(`ready http://${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
