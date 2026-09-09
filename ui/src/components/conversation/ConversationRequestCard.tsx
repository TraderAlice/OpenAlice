import { useState, type ReactElement } from 'react'
import { CircleHelp, LoaderCircle, ShieldQuestion } from 'lucide-react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'

export interface ConversationRequestOption {
  readonly id: string
  readonly label: string
  readonly tone: 'allow' | 'deny' | 'neutral'
}

export interface ConversationRequest {
  readonly id: string
  readonly kind: 'permission' | 'question'
  readonly allowText?: boolean
  readonly secret?: boolean
  readonly title: string
  readonly description?: string
  /** Pre-rendered tool detail; the adapter decides how the input is summarized. */
  readonly tool?: { readonly name: string; readonly summary: string | null; readonly input: string }
  readonly options: readonly ConversationRequestOption[]
}

export interface ConversationRequestCardProps {
  readonly request: ConversationRequest
  /** How many further requests wait behind this one. */
  readonly queued: number
  readonly respond: (requestId: string, optionId: string, text?: string) => Promise<void>
}

/**
 * The runtime stopped to ask something. Rendered pinned above the composer
 * rather than inline so the question is never scrolled away while the answer
 * is the only way forward; the transcript stays a record, the card is the
 * live decision. Options are shown verbatim from the runtime.
 */
export function ConversationRequestCard({ request, queued, respond }: ConversationRequestCardProps): ReactElement {
  const [pendingOption, setPendingOption] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const permission = request.kind === 'permission'

  async function choose(optionId: string, text?: string) {
    if (pendingOption !== null) return
    setPendingOption(optionId)
    setError(null)
    try { await respond(request.id, optionId, text) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPendingOption(null) }
  }

  return (
    <section
      className={`conversation-request${permission ? ' is-permission' : ' is-question'}`}
      role="group"
      aria-labelledby={`conversation-request-${request.id}`}
      aria-live="polite"
    >
      <header className="conversation-request-header">
        <span className="conversation-request-icon" aria-hidden="true">
          {permission ? <ShieldQuestion size={15} /> : <CircleHelp size={15} />}
        </span>
        <div className="conversation-request-heading">
          <span className="conversation-request-kicker">
            {permission ? 'Permission needed' : 'Question from the agent'}
            {queued > 0 && <span className="conversation-request-queue">+{queued} more</span>}
          </span>
          <h3 id={`conversation-request-${request.id}`} className="conversation-request-title">{request.title}</h3>
        </div>
      </header>
      {request.description && <p className="conversation-request-description">{request.description}</p>}
      {request.tool && (
        <details className="conversation-request-tool">
          <summary>
            <code>{request.tool.name}</code>
            {request.tool.summary && <span className="conversation-request-tool-summary">{request.tool.summary}</span>}
          </summary>
          <pre>{request.tool.input}</pre>
        </details>
      )}
      <div className="conversation-request-actions">
        {request.options.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={option.tone === 'allow' ? 'default' : option.tone === 'deny' ? 'outline' : 'secondary'}
            className={`conversation-request-option is-${option.tone}`}
            disabled={pendingOption !== null}
            aria-busy={pendingOption === option.id}
            onClick={() => void choose(option.id)}
          >
            {pendingOption === option.id && <LoaderCircle size={13} className="animate-spin" aria-hidden />}
            {option.label}
          </Button>
        ))}
      </div>
      {!permission && request.allowText && <form className="mt-3 flex flex-col gap-2" onSubmit={(event) => {
        event.preventDefault()
        if (answer.trim()) void choose('', answer)
      }}>
        <label htmlFor={`request-answer-${request.id}`} className="text-sm font-medium">
          {request.options.length ? 'Or write your own answer' : 'Your answer'}
        </label>
        {request.secret
          ? <input className="oa-field-control w-full rounded-md border border-input px-2.5 py-2 text-sm" id={`request-answer-${request.id}`} type="password" autoComplete="off" value={answer} disabled={pendingOption !== null} onChange={(event) => setAnswer(event.target.value)} />
          : <Textarea id={`request-answer-${request.id}`} value={answer} disabled={pendingOption !== null} onChange={(event) => setAnswer(event.target.value)} />}
        <Button type="submit" className="self-end" disabled={pendingOption !== null || !answer.trim()}>
          {pendingOption === '' && <LoaderCircle size={13} className="animate-spin" aria-hidden />}
          Send answer
        </Button>
      </form>}
      {error && <p className="conversation-request-error" role="alert">{error}</p>}
    </section>
  )
}
