import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type TopologyResponse, type EventLogEntry } from '../api'
import { PageLoading, EmptyState } from '../components/StateViews'

// ==================== Per-type docs ====================
//
// Static spec + curl/fetch recipes for each external event type. Kept here
// (rather than served from the API) so the docs read like prose instead of
// raw JSON Schema. When a new `external: true` event type lands in
// `AgentEvents`, add an entry here with the same shape.

interface PayloadField {
  name: string
  type: string
  required: boolean
  description: string
}

interface ExternalEventDoc {
  /** One-line summary for the card header. */
  summary: string
  /** Bulleted list of payload fields. */
  fields: PayloadField[]
  /** Example `payload` object for curl / JS snippets. */
  example: Record<string, unknown>
  /** Optional longer prose, rendered above the curl snippet. */
  notes?: string
}

const EXTERNAL_DOCS: Record<string, ExternalEventDoc> = {
  'task.requested': {
    summary:
      'Ask Alice to run a one-shot task. The prompt is sent through the agent and the reply is delivered back to whichever connector (Web / Telegram) you last interacted with.',
    fields: [
      {
        name: 'prompt',
        type: 'string',
        required: true,
        description: 'What you want Alice to do or check. Plain natural language.',
      },
    ],
    example: {
      prompt: 'Check if BTC moved more than 5% in the last hour.',
    },
    notes:
      'Task runs serially — if a task is still in flight when another arrives, the new one is skipped. Each task shares the `task/default` session, so Alice retains context across triggers.',
  },
}

// ==================== Helpers ====================

function buildCurl(origin: string, type: string, payload: unknown): string {
  const body = JSON.stringify({ type, payload }, null, 2)
  return `curl -X POST ${origin}/api/events/ingest \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer $OPENALICE_TOKEN' \\
  -d '${body.replace(/'/g, "'\\''")}'`
}

function buildFetch(type: string, payload: unknown): string {
  const body = JSON.stringify({ type, payload }, null, 2)
  return `await fetch('/api/events/ingest', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': \`Bearer \${process.env.OPENALICE_TOKEN}\`,
  },
  body: JSON.stringify(${body.replace(/\n/g, '\n  ')}),
})`
}

// ==================== Components ====================

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* no clipboard */ }
  }
  return (
    <div className="rounded-md border border-border bg-bg-tertiary overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-text-muted">{label ?? 'snippet'}</span>
        <button
          onClick={onCopy}
          className="text-[11px] text-text-muted hover:text-text transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="px-3 py-2 text-xs font-mono text-text overflow-x-auto whitespace-pre leading-relaxed">
        {code}
      </pre>
    </div>
  )
}

function EndpointCard() {
  return (
    <div className="rounded-lg border border-border bg-bg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded bg-accent/20 text-accent px-2 py-0.5 text-[11px] font-mono font-semibold">POST</span>
        <span className="font-mono text-sm text-text">/api/events/ingest</span>
      </div>
      <p className="text-[13px] text-text-muted leading-relaxed">
        Every request must present a bearer token via
        <code className="font-mono text-text mx-1">Authorization: Bearer &lt;token&gt;</code>
        or <code className="font-mono text-text mx-1">X-OpenAlice-Token: &lt;token&gt;</code>.
        Body: <code className="font-mono text-text">{'{ type: string, payload: object }'}</code>.
        Only event types explicitly marked <code className="font-mono text-text">external: true</code>
        on the backend are accepted.
      </p>
      <p className="text-[13px] text-text-muted leading-relaxed">
        Status codes: <code className="font-mono">201</code> on success (body is the appended
        event entry, <code className="font-mono">{'{ seq, ts, type, payload }'}</code>) ·
        <code className="font-mono mx-1">401</code> missing auth header ·
        <code className="font-mono mx-1">403</code> invalid token or non-external type ·
        <code className="font-mono mx-1">400</code> malformed body or schema violation ·
        <code className="font-mono mx-1">503</code> no tokens configured (default-deny).
      </p>
    </div>
  )
}

interface AuthStatus {
  configured: boolean
  tokenCount: number
  tokenIds: string[]
}

function AuthStatusCard() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/events/auth-status')
      .then((r) => r.json())
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  if (error) {
    return (
      <div className="rounded-lg border border-red/40 bg-bg p-4">
        <div className="text-[13px] text-red">Could not load auth status: {error}</div>
      </div>
    )
  }
  if (!status) return null

  if (!status.configured) {
    return (
      <div className="rounded-lg border border-red/60 bg-bg p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red" />
          <span className="text-sm font-medium text-text">Auth not configured</span>
        </div>
        <p className="text-[12px] text-text-muted leading-relaxed">
          The ingest endpoint is in default-deny mode — every request returns
          <code className="font-mono mx-1">503</code> until at least one token is added.
          Generate one and drop it into
          <code className="font-mono mx-1">data/config/webhook.json</code>:
        </p>
        <CodeBlock label="generate a 32-byte hex token" code="openssl rand -hex 32" />
        <CodeBlock
          label="data/config/webhook.json"
          code={`{
  "tokens": [
    {
      "id": "local-dev",
      "token": "<paste-token-here>"
    }
  ]
}`}
        />
        <p className="text-[12px] text-text-muted leading-relaxed">
          Changes take effect immediately — the config is re-read on every ingest request, no restart needed.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-green/40 bg-bg p-4 space-y-1">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green" />
        <span className="text-sm font-medium text-text">Auth configured</span>
        <span className="text-[12px] text-text-muted">
          {status.tokenCount} token{status.tokenCount === 1 ? '' : 's'}
        </span>
      </div>
      {status.tokenIds.length > 0 && (
        <div className="text-[12px] text-text-muted font-mono">
          ids: {status.tokenIds.join(', ')}
        </div>
      )}
      <p className="text-[12px] text-text-muted leading-relaxed">
        Rotate by adding a new entry with a fresh token, waiting for callers to switch, then removing the old one.
        Edit <code className="font-mono">data/config/webhook.json</code> directly — no restart needed.
      </p>
    </div>
  )
}

function EventTypeCard({ name, description, doc, origin }: {
  name: string
  description?: string
  doc: ExternalEventDoc | undefined
  origin: string
}) {
  if (!doc) {
    return (
      <div className="rounded-lg border border-border bg-bg p-4">
        <div className="font-mono text-sm text-text">{name}</div>
        <p className="text-[13px] text-text-muted mt-1">
          {description ?? 'External event type — no detailed docs yet.'}
        </p>
      </div>
    )
  }
  const curl = buildCurl(origin, name, doc.example)
  const js = buildFetch(name, doc.example)
  return (
    <div className="rounded-lg border border-border bg-bg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-text">{name}</span>
        <span className="inline-flex items-center rounded bg-accent/15 text-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">external</span>
      </div>

      <p className="text-[13px] text-text-muted leading-relaxed">{doc.summary}</p>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-text-muted mb-1.5">Payload</div>
        <div className="rounded-md border border-border/60 divide-y divide-border/60">
          {doc.fields.map((f) => (
            <div key={f.name} className="flex items-baseline gap-3 px-3 py-2">
              <div className="font-mono text-xs text-text w-36 shrink-0">
                {f.name}
                {f.required ? <span className="text-red ml-1">*</span> : null}
              </div>
              <div className="font-mono text-[11px] text-text-muted w-16 shrink-0">{f.type}</div>
              <div className="text-[12px] text-text-muted leading-snug">{f.description}</div>
            </div>
          ))}
        </div>
      </div>

      {doc.notes ? (
        <p className="text-[12px] text-text-muted leading-relaxed italic">{doc.notes}</p>
      ) : null}

      <CodeBlock label="curl" code={curl} />
      <CodeBlock label="fetch (browser / node)" code={js} />
    </div>
  )
}

const TOKEN_STORAGE_KEY = 'openalice.webhookTryItToken'

function TryItForm() {
  const [prompt, setPrompt] = useState('Check if BTC moved more than 5% in the last hour.')
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem(TOKEN_STORAGE_KEY) ?? '' } catch { return '' }
  })
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<EventLogEntry | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSend = async () => {
    if (!prompt.trim()) return
    setSending(true)
    setResult(null)
    setError(null)
    try {
      try { localStorage.setItem(TOKEN_STORAGE_KEY, token) } catch { /* storage disabled */ }
      const entry = await api.events.ingest(
        'task.requested',
        { prompt: prompt.trim() },
        { token: token.trim() || undefined },
      )
      setResult(entry)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-lg border border-accent/40 bg-bg p-4 space-y-3">
      <div>
        <div className="text-sm font-medium text-text">Try it</div>
        <p className="text-[12px] text-text-muted mt-0.5">
          Fires a <code className="font-mono">task.requested</code> event. Watch the Flow tab to see the pulse —
          the reply will be dispatched to whichever connector you last used.
        </p>
      </div>

      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Bearer token (from data/config/webhook.json)"
        className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-xs font-mono text-text outline-none focus:border-accent"
      />

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        className="w-full bg-bg-tertiary border border-border rounded-md px-3 py-2 text-sm text-text outline-none focus:border-accent resize-none"
        placeholder="Prompt for Alice…"
      />

      <div className="flex items-center gap-3">
        <button
          onClick={handleSend}
          disabled={sending || !prompt.trim()}
          className="btn-primary-sm"
        >
          {sending ? 'Sending…' : 'Send task.requested'}
        </button>
        {result && (
          <span className="text-[12px] text-green">
            Accepted — seq #{result.seq}
          </span>
        )}
        {error && (
          <span className="text-[12px] text-red">{error}</span>
        )}
      </div>

      <p className="text-[11px] text-text-muted">
        Token is cached in this browser's localStorage for your convenience — clear it by emptying the field and sending.
      </p>
    </div>
  )
}

// ==================== Section ====================

export function AutomationWebhookSection() {
  const { t } = useTranslation()
  const [topology, setTopology] = useState<TopologyResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    api.topology.get()
      .then(setTopology)
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
  }, [])

  const externalTypes = useMemo(
    () => (topology?.eventTypes ?? []).filter((t) => t.external),
    [topology],
  )

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3002'

  if (loadError) {
    return <EmptyState title={t('automation.failedToLoadTopology')} description={loadError} />
  }
  if (!topology) return <PageLoading />

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[880px] mx-auto space-y-5">
        <div className="rounded-lg border border-border/50 bg-bg-secondary/50 px-4 py-3">
          <p className="text-[13px] text-text-muted leading-relaxed">
            Trigger Alice from outside the process. Any HTTP client — TradingView alert webhook, a server
            crontab running <code className="font-mono">curl</code>, Zapier/Make, a custom script — can POST
            an event to the ingest endpoint below. Accepted events flow through the same bus as internal
            events; the Flow tab shows the injection arrive and the task listener fire in real time.
          </p>
        </div>

        <EndpointCard />

        <AuthStatusCard />

        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted mb-2">
            Accepted event types ({externalTypes.length})
          </div>
          {externalTypes.length === 0 ? (
            <div className="rounded-lg border border-border/50 bg-bg-secondary/30 px-4 py-6 text-center text-[13px] text-text-muted">
              No event types are currently marked external. Mark an event as
              <code className="font-mono mx-1">external: true</code> in <code className="font-mono">AgentEvents</code>
              to expose it here.
            </div>
          ) : (
            <div className="space-y-3">
              {externalTypes.map((t) => (
                <EventTypeCard
                  key={t.name}
                  name={t.name}
                  description={t.description}
                  doc={EXTERNAL_DOCS[t.name]}
                  origin={origin}
                />
              ))}
            </div>
          )}
        </div>

        {externalTypes.some((t) => t.name === 'task.requested') && (
          <TryItForm />
        )}
      </div>
    </div>
  )
}
