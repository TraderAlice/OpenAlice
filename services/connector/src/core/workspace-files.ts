import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { connectorAttachmentSchema, type ConnectorAttachment } from '@traderalice/connector-protocol'

/** Calls Alice's generic file API. Neither paths nor URLs come from model-selected hosts. */
export async function fetchWorkspaceAttachment(workspaceId: string, path: string): Promise<ConnectorAttachment> {
  const port = Number(process.env['OPENALICE_MCP_PORT'] ?? 47332)
  const url = new URL(`http://127.0.0.1:${port}/cli/workspace-files/${encodeURIComponent(workspaceId)}`)
  url.searchParams.set('path', path)
  const socketPath = process.env['OPENALICE_TOOL_SOCKET']
  const raw = await new Promise<string>((resolve, reject) => {
    const req = request(socketPath ? { socketPath, path: url.pathname + url.search } : url, res => {
      let size = 0
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 1_500_000) { req.destroy(new Error('File response too large')); return }
        chunks.push(chunk)
      })
      res.on('error', reject)
      res.on('end', () => res.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error('Workspace file unavailable')))
    })
    req.setTimeout(10_000, () => req.destroy(new Error('Workspace file read timed out')))
    req.on('error', reject)
    req.end()
  })
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
