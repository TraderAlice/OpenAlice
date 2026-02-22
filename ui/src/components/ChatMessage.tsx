import { useMemo, useRef, useEffect, useCallback } from 'react'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import 'highlight.js/styles/github-dark.min.css'

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
  timestamp?: number | null
}

const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
const CHECK_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`

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

export function ChatMessage({ role, text, timestamp }: ChatMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  const html = useMemo(() => {
    if (role === 'user') return null
    const raw = DOMPurify.sanitize(marked.parse(text) as string)
    return addCodeBlockWrappers(raw)
  }, [role, text])

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
      <div className="flex flex-col items-center message-enter">
        <div className="max-w-[90%] px-4 py-2.5 bg-notification-bg border border-notification-border rounded-lg text-[13px] break-words">
          <div className="markdown-content" dangerouslySetInnerHTML={{ __html: `\ud83d\udd14 ${html}` }} />
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
      <div className="text-[11px] text-text-muted mb-1 ml-1 font-medium tracking-wide uppercase">Alice</div>
      <div ref={contentRef} className="max-w-[90%] break-words leading-relaxed">
        <div className="markdown-content" dangerouslySetInnerHTML={{ __html: html! }} />
      </div>
      {timestamp && (
        <div className="text-[11px] text-text-muted mt-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {new Date(timestamp).toLocaleString()}
        </div>
      )}
    </div>
  )
}

export function ThinkingIndicator() {
  return (
    <div className="flex flex-col items-start message-enter">
      <div className="text-[11px] text-text-muted mb-1 ml-1 font-medium tracking-wide uppercase">Alice</div>
      <div className="text-text-muted px-1">
        <div className="flex">
          <span className="thinking-dot">.</span>
          <span className="thinking-dot">.</span>
          <span className="thinking-dot">.</span>
        </div>
      </div>
    </div>
  )
}
