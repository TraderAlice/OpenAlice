import { createServer } from 'node:http'

export const WORKSPACE_ACCEPTANCE_MARKER = 'OPENALICE_PACKAGED_WORKSPACE_CLI_ACCEPTANCE'
export const WORKSPACE_ACCEPTANCE_AGENT_ISSUE_ID = 'openalice-agent-cli-acceptance'
export const WORKSPACE_ACCEPTANCE_ASSISTANT_TEXT = 'OpenAlice Workspace CLI acceptance completed.'

function chunk(id, choices, usage) {
  return JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'openalice-workspace-acceptance',
    choices,
    ...(usage ? { usage } : {}),
  })
}

function sse(chunks) {
  return [...chunks.map((entry) => `data: ${entry}`), 'data: [DONE]', ''].join('\n\n')
}

export function textCompletionStream(text, id = 'chatcmpl-openalice-smoke') {
  return sse([
    chunk(id, [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]),
    chunk(id, [{ index: 0, delta: { content: text }, finish_reason: null }]),
    chunk(id, [{ index: 0, delta: {}, finish_reason: 'stop' }], {
      prompt_tokens: 8,
      completion_tokens: 8,
      total_tokens: 16,
    }),
  ])
}

export function cliToolCallStream(id = 'chatcmpl-openalice-cli-tool') {
  const command = [
    'alice-workspace issue create',
    `--id ${WORKSPACE_ACCEPTANCE_AGENT_ISSUE_ID}`,
    '--title "OpenAlice agent CLI acceptance"',
  ].join(' ')
  return sse([
    chunk(id, [{
      index: 0,
      delta: {
        role: 'assistant',
        tool_calls: [{
          index: 0,
          id: 'call_openalice_workspace_cli',
          type: 'function',
          function: { name: 'bash', arguments: JSON.stringify({ command }) },
        }],
      },
      finish_reason: null,
    }]),
    chunk(id, [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], {
      prompt_tokens: 8,
      completion_tokens: 8,
      total_tokens: 16,
    }),
  ])
}

function requestHasToolResult(body) {
  return Array.isArray(body?.messages) && body.messages.some((message) => message?.role === 'tool')
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

/**
 * Deterministic OpenAI-compatible provider used only by packaged acceptance.
 * The first acceptance turn asks Pi's built-in bash tool to execute the real
 * Workspace CLI. The second turn acknowledges the tool result. Ordinary
 * readiness probes still receive a plain assistant response.
 */
export async function startWorkspaceAcceptanceAiMock() {
  const stats = {
    readinessTurns: 0,
    acceptanceToolTurns: 0,
    acceptanceFinalTurns: 0,
  }
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Not found' } }))
      return
    }
    if (req.headers.authorization !== 'Bearer oa_test_ok') {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid smoke test key' } }))
      return
    }

    try {
      const body = await readJson(req)
      const isAcceptance = JSON.stringify(body).includes(WORKSPACE_ACCEPTANCE_MARKER)
      let payload
      if (!isAcceptance) {
        stats.readinessTurns += 1
        payload = textCompletionStream('OpenAlice packaged runtime is ready.')
      } else if (requestHasToolResult(body)) {
        stats.acceptanceFinalTurns += 1
        payload = textCompletionStream(WORKSPACE_ACCEPTANCE_ASSISTANT_TEXT)
      } else {
        stats.acceptanceToolTurns += 1
        payload = cliToolCallStream()
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.end(payload)
    } catch (err) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: err instanceof Error ? err.message : String(err) } }))
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('workspace acceptance AI mock did not bind a TCP port')
  }
  return {
    server,
    stats,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  }
}
