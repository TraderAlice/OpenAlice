/**
 * Reusable markdown renderer with syntax-highlighted code blocks and copy buttons.
 *
 * Extracted from ChatMessage so other surfaces can render assistant text with
 * the same typography without inheriting chat chrome.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import 'highlight.js/styles/github-dark.min.css'

// Shared Marked instance (parser config is stateless — safe to reuse).
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

interface MarkdownContentProps {
  text: string
  className?: string
}

export function MarkdownContent({ text, className }: MarkdownContentProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  const html = useMemo(() => {
    const raw = DOMPurify.sanitize(marked.parse(text) as string)
    return addCodeBlockWrappers(raw)
  }, [text])

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

  return (
    <div ref={contentRef} className={className}>
      <div className="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
