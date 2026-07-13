/**
 * Reusable markdown renderer with syntax-highlighted code blocks and copy buttons.
 *
 * Extracted from ChatMessage so other surfaces can render assistant text with
 * the same typography without inheriting chat chrome.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Marked, type TokenizerAndRendererExtension } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import 'highlight.js/styles/github-dark.min.css'

import { useWikilinkHandler } from '../live/wikilink'
import { useWorkspaces } from '../contexts/workspaces-context'
import { resolveSessionSignature } from './workspace/api'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Obsidian-style `[[name]]` wikilinks → clickable entity references.
 *
 * Inline marked extension (not a regex preprocess) so it never fires
 * inside code spans / fenced blocks — marked only offers the token stream
 * to extensions in inline contexts. Mirrors the backend matcher in
 * `src/core/entity-backlinks.ts` (`/\[\[([^[\]\n]+)\]\]/`). The rendered
 * anchor carries the lowercased entity key in `data-entity` (entity keys
 * are case-insensitive); MarkdownContent delegates the actual navigation
 * on click so this module stays a pure string renderer.
 */
function createWikilinkExtension(opts: { codeSpanWikilinks: boolean }): TokenizerAndRendererExtension {
  return {
    name: 'wikilink',
    level: 'inline',
    start(src: string) {
      const plain = src.indexOf('[[')
      if (!opts.codeSpanWikilinks) return plain
      const quoted = src.indexOf('`[[')
      if (plain < 0) return quoted
      if (quoted < 0) return plain
      return Math.min(plain, quoted)
    },
    tokenizer(src: string) {
      const quoted = opts.codeSpanWikilinks ? /^`\[\[([^[\]\n]+)\]\]`/.exec(src) : null
      if (quoted) return { type: 'wikilink', raw: quoted[0], text: quoted[1]!.trim() }
      const plain = /^\[\[([^[\]\n]+)\]\]/.exec(src)
      if (!plain) return undefined
      return { type: 'wikilink', raw: plain[0], text: plain[1]!.trim() }
    },
    renderer(token) {
      const name = token.text as string
      const key = name.toLowerCase()
      return `<a class="wikilink" data-entity="${escapeHtml(key)}">${escapeHtml(name)}</a>`
    },
  }
}

/** `@resumeId` is the visible signature of an accountable product Session.
 * Like wikilinks this is an inline tokenizer, so examples in code remain text. */
const sessionSignatureExtension: TokenizerAndRendererExtension = {
  name: 'sessionSignature',
  level: 'inline',
  start: (src) => src.indexOf('@resume-'),
  tokenizer(src) {
    const match = /^@(resume-[A-Za-z0-9_-]+)/.exec(src)
    return match ? { type: 'sessionSignature', raw: match[0], text: match[1] } : undefined
  },
  renderer(token) {
    const resumeId = token.text as string
    return `<a class="session-signature" data-resume-id="${escapeHtml(resumeId)}">@${escapeHtml(resumeId)}</a>`
  },
}

function createMarked(opts: { strikethrough: boolean; codeSpanWikilinks: boolean }): Marked {
  const instance = new Marked(
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
  instance.use({ extensions: [
    createWikilinkExtension({ codeSpanWikilinks: opts.codeSpanWikilinks }),
    sessionSignatureExtension,
  ] })
  if (!opts.strikethrough) {
    instance.use({
      tokenizer: {
        del() {
          return undefined
        },
      },
    })
  }
  return instance
}

// Shared Marked instances (parser config is stateless — safe to reuse).
const markedWithStrikethrough = createMarked({ strikethrough: true, codeSpanWikilinks: false })
const markedWithoutStrikethrough = createMarked({ strikethrough: false, codeSpanWikilinks: false })
const markedWithCodeSpanWikilinks = createMarked({ strikethrough: true, codeSpanWikilinks: true })
const markedComment = createMarked({ strikethrough: false, codeSpanWikilinks: true })

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
  /**
   * GitHub-flavoured `~~delete~~` rendering. Disable on terse agent comments
   * because financial prose often uses `~$123` for approximate prices.
   */
  strikethrough?: boolean
  /**
   * Treat an exact code span like `` `[[name]]` `` as a wikilink. Inbox
   * comments often quote entity refs this way, but they should still navigate.
   */
  codeSpanWikilinks?: boolean
  /**
   * Click handler for `[[name]]` wikilinks, receiving the lowercased entity
   * key. Defaults to jumping to the Tracked activity (see useWikilinkHandler).
   * Pass an explicit handler to override (e.g. tests, alternate surfaces).
   */
  onWikilink?: (entityKey: string) => void
}

export function renderMarkdownHtml(
  text: string,
  opts: { strikethrough?: boolean; codeSpanWikilinks?: boolean } = {},
): string {
  const parser = opts.codeSpanWikilinks
    ? opts.strikethrough === false
      ? markedComment
      : markedWithCodeSpanWikilinks
    : opts.strikethrough === false
      ? markedWithoutStrikethrough
      : markedWithStrikethrough
  const raw = DOMPurify.sanitize(parser.parse(text) as string)
  return addCodeBlockWrappers(raw)
}

export function MarkdownContent({
  text,
  className,
  strikethrough = true,
  codeSpanWikilinks = false,
  onWikilink,
}: MarkdownContentProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const defaultWikilink = useWikilinkHandler()
  const { openHeadlessRun } = useWorkspaces()
  const wikilink = onWikilink ?? defaultWikilink

  const html = useMemo(() => {
    return renderMarkdownHtml(text, { strikethrough, codeSpanWikilinks })
  }, [text, strikethrough, codeSpanWikilinks])

  const handleClick = useCallback(
    (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const link = target.closest('a.wikilink') as HTMLElement | null
      if (link) {
        e.preventDefault()
        const key = link.getAttribute('data-entity')
        if (key) wikilink(key)
        return
      }
      const signature = target.closest('a.session-signature') as HTMLElement | null
      if (signature) {
        e.preventDefault()
        const resumeId = signature.getAttribute('data-resume-id')
        if (resumeId) {
          void resolveSessionSignature(resumeId)
            .then((identity) => {
              if (!identity.resumable) throw new Error('This Session has not captured a resumable runtime conversation yet.')
              return openHeadlessRun(identity.workspaceId, identity.resumeId)
            })
            .catch((err) => console.error('session_signature.open_failed', { resumeId, err }))
        }
        return
      }
      const btn = target.closest('.code-copy-btn') as HTMLButtonElement | null
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
    },
    [wikilink, openHeadlessRun],
  )

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [handleClick])

  return (
    <div ref={contentRef} className={className}>
      <div className="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
