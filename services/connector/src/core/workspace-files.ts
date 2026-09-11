import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { connectorAttachmentSchema, type ConnectorAttachment } from '@traderalice/connector-protocol'

/** Calls Alice's generic file API. Neither paths nor URLs come from model-selected hosts. */
export async function fetchWorkspaceAttachment(workspaceId: string, path: string): Promise<ConnectorAttachment> {
  const raw = await fetchAliceJson(`/cli/workspace-files/${encodeURIComponent(workspaceId)}?${new URLSearchParams({ path })}`)
  const file = JSON.parse(raw) as { filename: string; contentBase64: string }
  const bytes = Buffer.from(file.contentBase64, 'base64')
  return connectorAttachmentSchema.parse({ filename: file.filename, contentBase64: file.contentBase64, sizeBytes: bytes.length,
    mediaType: mediaType(file.filename), contentSha256: createHash('sha256').update(bytes).digest('hex') })
}

function mediaType(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', html: 'text/html',
    json: 'application/json' } as Record<string, string>)[extension] ?? 'application/octet-stream'
}

/** Fixed local gateway; model input cannot choose a host or socket. */
export async function fetchAliceJson(route: string, body?: unknown): Promise<string> {
  const port = Number(process.env['OPENALICE_MCP_PORT'] ?? 47332)
  const url = new URL(route, `http://127.0.0.1:${port}`)
  const socketPath = process.env['OPENALICE_TOOL_SOCKET']
  const raw = await new Promise<string>((resolve, reject) => {
    const req = request({ ...(socketPath ? { socketPath } : { hostname: url.hostname, port: url.port }), path: url.pathname + url.search, method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let size = 0
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 1_500_000) { req.destroy(new Error('Alice response too large')); return }
        chunks.push(chunk)
      })
      res.on('error', reject)
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode === 200) { resolve(text); return }
        // Only the model control endpoint returns deliberately user-facing errors.
        if (res.statusCode === 400 && route.startsWith('/cli/connector-model/')) {
          try { const result = JSON.parse(text); if (typeof result.error === 'string') { reject(new Error(result.error)); return } } catch { /* generic transport error */ }
        }
        reject(new Error(`Alice resource unavailable (${res.statusCode})`))
      })
    })
    req.setTimeout(10_000, () => req.destroy(new Error('Alice request timed out')))
    req.on('error', reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
  return raw
}
