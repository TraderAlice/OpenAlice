import { useEffect, useState, type ReactElement } from 'react'
import { Check, ChevronRight, CircleAlert, CircleDashed, LoaderCircle } from 'lucide-react'
import { MarkdownContent } from '../MarkdownContent'
import type { ConversationActivity, ConversationContent, ConversationItem, ConversationToolStep } from './types'

export function ConversationTranscriptItem({
  item,
  working,
}: {
  readonly item: ConversationItem
  readonly working: boolean
}): ReactElement {
  if (item.kind === 'user') {
    return (
      <article className="conversation-message is-user">
        <div className="conversation-message-body"><ConversationContentView content={item.content} /></div>
      </article>
    )
  }
  if (item.kind === 'unknown') {
    return (
      <article className="conversation-message is-assistant">
        <div className="conversation-message-body"><ConversationContentView content={item.content} /></div>
      </article>
    )
  }
  return (
    <article className="conversation-message is-assistant is-turn">
      <div className="conversation-message-body">
        {item.progress.map((text, index) => (
          <div key={index} className="conversation-progress-text"><MarkdownContent text={text} /></div>
        ))}
        {item.activity && <ConversationActivityGroup activity={item.activity} working={working} />}
        {item.final && <div className="conversation-final-text"><MarkdownContent text={item.final} /></div>}
      </div>
    </article>
  )
}

function ConversationActivityGroup({ activity, working }: { readonly activity: ConversationActivity; readonly working: boolean }): ReactElement {
  const failedCount = activity.steps.filter((step) => step.status === 'failed').length
  const running = activity.steps.some((step) => step.status === 'running')
  const thinkingCount = activity.thinking.length
    + activity.steps.reduce((count, step) => count + step.thinking.length, 0)
  const [open, setOpen] = useState(failedCount > 0)

  useEffect(() => {
    if (failedCount > 0) setOpen(true)
  }, [failedCount])

  const title = failedCount > 0
    ? `${failedCount} failed`
    : running ? (working ? 'Working' : 'Incomplete')
      : activity.steps.length > 0 ? `${activity.steps.length} action${activity.steps.length === 1 ? '' : 's'}`
        : 'Reasoning'
  const tools = activity.steps.map((step) => step.name).filter((name, index, names) => names.indexOf(name) === index).join(' · ')
  const detail = tools || (thinkingCount > 0 ? `${thinkingCount} note${thinkingCount === 1 ? '' : 's'}` : 'Details')

  return (
    <details
      className={`conversation-activity${failedCount > 0 ? ' is-error' : ''}${running ? ' is-running' : ''}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="conversation-activity-status" aria-hidden="true">
          {failedCount > 0
            ? <CircleAlert size={14} />
            : running
              ? working ? <LoaderCircle size={14} className="animate-spin" /> : <CircleDashed size={14} />
              : <Check size={14} />}
        </span>
        <span className="conversation-activity-title">{title}</span>
        <span className="conversation-activity-meta">{detail}</span>
        <ChevronRight size={14} className="conversation-disclosure" aria-hidden="true" />
      </summary>
      <div className="conversation-activity-body">
        {activity.steps.map((step) => <ConversationToolStepView key={step.id} step={step} working={working} />)}
        {activity.thinking.length > 0 && (
          <ConversationReasoning notes={activity.thinking} label="Final reasoning" />
        )}
        {activity.unknownParts.length > 0 && (
          <details className="conversation-reasoning">
            <summary>Raw events · {activity.unknownParts.length}</summary>
            <pre>{activity.unknownParts.join('\n\n')}</pre>
          </details>
        )}
      </div>
    </details>
  )
}

function ConversationToolStepView({ step, working }: { readonly step: ConversationToolStep; readonly working: boolean }): ReactElement {
  const failed = step.status === 'failed'
  const [open, setOpen] = useState(failed)
  const summary = step.summary
  const resultChars = step.resultChars ?? null

  useEffect(() => {
    if (failed) setOpen(true)
  }, [failed])

  return (
    <details
      className={`conversation-tool-step is-${step.status}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="conversation-step-status" aria-hidden="true">
          {failed
            ? <CircleAlert size={13} />
            : step.status === 'running'
              ? working ? <LoaderCircle size={13} className="animate-spin" /> : <CircleDashed size={13} />
              : <Check size={13} />}
        </span>
        <code>{step.name}</code>
        <span className="conversation-step-summary">{summary ?? (step.status === 'running' ? 'Running…' : 'Completed')}</span>
        {resultChars !== null && <span className="conversation-step-size">{formatChars(resultChars)}</span>}
        <ChevronRight size={13} className="conversation-disclosure" aria-hidden="true" />
      </summary>
      <div className="conversation-step-detail">
        {step.thinking.length > 0 && <ConversationReasoning notes={step.thinking} label="Reasoning" />}
        <section>
          <h4>Input</h4>
          <pre>{step.input}</pre>
        </section>
        {step.result !== undefined && (
          <section>
            <h4>{failed ? 'Error' : 'Result'}</h4>
            <div className="conversation-step-result"><ConversationContentView content={step.result} /></div>
          </section>
        )}
      </div>
    </details>
  )
}

function ConversationReasoning({ notes, label }: { readonly notes: readonly string[]; readonly label: string }): ReactElement {
  return (
    <details className="conversation-reasoning">
      <summary>{label} · {notes.length}</summary>
      <div className="conversation-reasoning-notes">
        {notes.map((note, index) => <MarkdownContent key={index} text={note} />)}
      </div>
    </details>
  )
}


export function ConversationContentView({ content }: { readonly content: ConversationContent }): ReactElement {
  return <div className="conversation-content-parts">{content.map((block, index) => {
    if (block.kind === 'markdown') return <MarkdownContent key={index} text={block.text} />
    if (block.kind === 'disclosure') return <details key={index} className="conversation-detail"><summary>{block.label}</summary><ConversationContentView content={block.content} /></details>
    return <pre key={index} className="conversation-unknown">{block.text}</pre>
  })}</div>
}

function formatChars(chars: number): string {
  if (chars < 1_000) return `${chars} chars`
  return `${(chars / 1_000).toFixed(chars < 10_000 ? 1 : 0)}k chars`
}
