import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import type { ToolCall, StreamingToolCall } from '../api'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import 'highlight.js/styles/github-dark.min.css'
import { KlineChart } from './KlineChart'
import type { KlineDataPoint } from './KlineChart'

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value
      }
      return hljs.highlightAuto(code).value
    },
  }),
  { breaks: true },
)

interface ChatMessageProps {
  role: 'user' | 'assistant' | 'notification'
  text: string
  timestamp?: string | number | null
  /** True when this message follows another message of the same role — hides the label/avatar */
  isGrouped?: boolean
  media?: Array<{ type: string; url: string }>
}

const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
const CHECK_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`

function AliceAvatar() {
  return (
    <img
      src="/alice.ico"
      alt="Alice"
      className="w-6 h-6 rounded-full ring-1 ring-accent/20 shrink-0"
      draggable={false}
    />
  )
}

// ==================== Kline block extraction ====================

interface ContentSegment {
  type: 'text' | 'kline'
  content: string // markdown text or raw JSON
  kline?: { symbol?: string; name?: string; data: KlineDataPoint[] }
}

const KLINE_FENCE = /```kline\s*\n([\s\S]*?)```/g

function extractKlineSegments(text: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = KLINE_FENCE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }
    try {
      const parsed = JSON.parse(match[1])
      segments.push({
        type: 'kline',
        content: match[1],
        kline: {
          symbol: parsed.symbol,
          name: parsed.name,
          data: parsed.data,
        },
      })
    } catch {
      // Malformed JSON — render as regular code block
      segments.push({ type: 'text', content: match[0] })
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) })
  }

  // Reset regex lastIndex for next call
  KLINE_FENCE.lastIndex = 0

  return segments.length > 0 ? segments : [{ type: 'text', content: text }]
}

// ==================== Code block wrappers ====================

function addCodeBlockWrappers(html: string): string {
  return html.replace(
    /<pre><code class="hljs language-(\w+)">([\s\S]*?)<\/code><\/pre>/g,
    (_, lang, code) =>
      `<div class="code-block-wrapper"><div class="code-header"><span>${lang}</span><button class="code-copy-btn" data-code>${COPY_ICON} Copy</button></div><pre><code class="hljs language-${lang}">${code}</code></pre></div>`,
  ).replace(
    /<pre><code class="hljs">([\s\S]*?)<\/code><\/pre>/g,
    (_, code) =>
      `<div class="code-block-wrapper"><div class="code-header"><span>code</span><button class="code-copy-btn" data-code>${COPY_ICON} Copy</button></div><pre><code class="hljs">${code}</code></pre></div>`,
  )
}

export function ChatMessage({ role, text, timestamp, isGrouped, media }: ChatMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  const segments = useMemo(() => {
    if (role === 'user') return null
    return extractKlineSegments(text)
  }, [role, text])

  const renderSegment = useCallback((seg: ContentSegment, i: number) => {
    if (seg.type === 'kline' && seg.kline) {
      return <KlineChart key={i} symbol={seg.kline.symbol} name={seg.kline.name} data={seg.kline.data} />
    }
    const raw = DOMPurify.sanitize(marked.parse(seg.content) as string)
    const html = addCodeBlockWrappers(raw)
    return <div key={i} className="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />
  }, [])

  const handleCopyClick = useCallback((e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('.code-copy-btn') as HTMLButtonElement | null
    if (!btn) return
    const wrapper = btn.closest('.code-block-wrapper')
    const code = wrapper?.querySelector('code')?.textContent ?? ''
    navigator.clipboard.writeText(code).then(() => {
      btn.innerHTML = `${CHECK_ICON} Copied!`
      btn.classList.add('copied')
      setTimeout(() => {
        btn.innerHTML = `${COPY_ICON} Copy`
        btn.classList.remove('copied')
      }, 2000)
    })
  }, [])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    el.addEventListener('click', handleCopyClick)
    return () => el.removeEventListener('click', handleCopyClick)
  }, [handleCopyClick])

  if (role === 'notification') {
    return (
      <div className="flex items-start gap-3 message-enter ml-8">
        <div className="w-0.5 shrink-0 self-stretch rounded-full bg-notification-border" />
        <div className="flex-1 min-w-0 py-0.5">
          <div className="flex items-center gap-1.5 mb-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-notification-border shrink-0">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="text-[11px] text-text-muted/60 font-medium">Notification</span>
          </div>
          <div ref={contentRef} className="text-[13px] text-text-muted break-words leading-relaxed">
            {segments?.map(renderSegment)}
            {media?.map((m, i) => (
              <img key={i} src={m.url} alt="" className="max-w-full rounded-lg mt-2" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (role === 'user') {
    return (
      <div className="flex flex-col items-end message-enter group">
        <div className="max-w-[75%] px-4 py-3 bg-user-bubble rounded-2xl rounded-br-sm break-words">
          <span className="whitespace-pre-wrap leading-relaxed">{text}</span>
        </div>
        {timestamp && (
          <div className="text-[11px] text-text-muted mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {new Date(timestamp).toLocaleString()}
          </div>
        )}
      </div>
    )
  }

  // Assistant
  return (
    <div className="flex flex-col items-start message-enter group">
      {!isGrouped && (
        <div className="flex items-center gap-2 mb-1.5">
          <AliceAvatar />
          <span className="text-[12px] text-text-muted font-medium">Alice</span>
        </div>
      )}
      <div ref={contentRef} className="max-w-[90%] break-words leading-relaxed ml-8 bg-bg-tertiary/30 border border-border/30 rounded-2xl rounded-tl-sm px-4 py-3">
        {segments?.map(renderSegment)}
        {media?.map((m, i) => (
          <img key={i} src={m.url} alt="" className="max-w-full rounded-lg mt-2" />
        ))}
      </div>
      {timestamp && (
        <div className="text-[11px] text-text-muted mt-1 ml-8 opacity-0 group-hover:opacity-100 transition-opacity">
          {new Date(timestamp).toLocaleString()}
        </div>
      )}
    </div>
  )
}

// ==================== Tool Call Group ====================

interface ToolCallGroupProps {
  calls: ToolCall[]
  timestamp?: string | null
}

/** Try to highlight JSON, fall back to plain text */
function highlightJSON(text: string): string {
  try {
    const parsed = JSON.parse(text)
    const formatted = JSON.stringify(parsed, null, 2)
    return hljs.highlight(formatted, { language: 'json' }).value
  } catch {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

export function ToolCallGroup({ calls, timestamp }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(false)

  const summary = calls.map((c) => c.name).join(', ')

  return (
    <div className="flex flex-col items-start ml-8">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-secondary/80 border border-border text-text-muted text-[12px] hover:text-text hover:border-border hover:bg-bg-secondary transition-all cursor-pointer select-none"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        <span className="truncate max-w-[400px]">{summary}</span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-1.5 ml-1 border-l-2 border-border/60 pl-3 flex flex-col gap-3 py-1">
          {calls.map((call, i) => (
            <div key={i} className="text-[12px]">
              <div className="text-text-muted font-medium mb-1">{call.name}</div>
              <pre
                className="text-[11px] font-mono whitespace-pre-wrap break-all leading-relaxed bg-bg/50 rounded-md px-2.5 py-1.5 border border-border/40"
                dangerouslySetInnerHTML={{ __html: highlightJSON(call.input) }}
              />
              {call.result && (
                <pre
                  className="text-[11px] font-mono whitespace-pre-wrap break-all mt-1 leading-relaxed bg-bg/50 rounded-md px-2.5 py-1.5 border border-green/20 text-green/80"
                  dangerouslySetInnerHTML={{ __html: highlightJSON(call.result) }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {timestamp && (
        <div className="text-[11px] text-text-muted mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {new Date(timestamp).toLocaleString()}
        </div>
      )}
    </div>
  )
}

// ==================== Streaming Tool Group ====================

interface StreamingToolGroupProps {
  tools: StreamingToolCall[]
}

export function StreamingToolGroup({ tools }: StreamingToolGroupProps) {
  return (
    <div className="flex flex-col items-start ml-8 gap-1">
      {tools.map((tool) => (
        <div
          key={tool.id}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-secondary/80 border border-border text-[12px] text-text-muted"
        >
          {tool.status === 'running' ? (
            <span className="inline-block w-3 h-3 border-2 border-text-muted/30 border-t-text-muted rounded-full animate-spin" />
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-500">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          <span>{tool.name}</span>
        </div>
      ))}
    </div>
  )
}

export function ThinkingIndicator() {
  return (
    <div className="flex flex-col items-start message-enter">
      <div className="flex items-center gap-2 mb-1.5">
        <AliceAvatar />
        <span className="text-[12px] text-text-muted font-medium">Alice</span>
      </div>
      <div className="text-text-muted ml-8">
        <div className="flex">
          <span className="thinking-dot">.</span>
          <span className="thinking-dot">.</span>
          <span className="thinking-dot">.</span>
        </div>
      </div>
    </div>
  )
}
