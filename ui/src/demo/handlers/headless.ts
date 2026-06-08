import { http, HttpResponse } from 'msw'

const now = Date.now()
const demoHeadlessTasks = [
  {
    taskId: 'demo-headless-1',
    wsId: 'demo-finance-research',
    agent: 'codex',
    prompt: 'Compute a quant snapshot of NVDA and push a report to the inbox.',
    status: 'done',
    startedAt: now - 92_000,
    finishedAt: now - 20_000,
    durationMs: 72_000,
    exitCode: 0,
  },
  {
    taskId: 'demo-headless-2',
    wsId: 'demo-chat',
    agent: 'claude',
    prompt: "Summarize today's AI-sector headlines and flag anything actionable.",
    status: 'running',
    startedAt: now - 6_000,
  },
  {
    taskId: 'demo-headless-3',
    wsId: 'demo-finance-research',
    agent: 'pi',
    prompt: 'Refresh the uranium watchlist and note any breakouts.',
    status: 'interrupted',
    startedAt: now - 3_600_000,
    finishedAt: now - 3_600_000,
  },
]

export const headlessHandlers = [
  http.get('/api/headless', () => HttpResponse.json({ tasks: demoHeadlessTasks })),
  http.get('/api/headless/:taskId', ({ params }) => {
    const t = demoHeadlessTasks.find((x) => x.taskId === params.taskId)
    return t ? HttpResponse.json(t) : HttpResponse.json({ error: 'not_found' }, { status: 404 })
  }),
]
