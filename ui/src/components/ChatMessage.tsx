import { useMemo } from 'react'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
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

export function ChatMessage({ role, text, timestamp }: ChatMessageProps) {
  const html = useMemo(() => {
    if (role === 'user') return null
    return marked.parse(text) as string
  }, [role, text])

  return (
    <div
      className={`flex flex-col ${
        role === 'user'
          ? 'items-end'
          : role === 'notification'
            ? 'items-center'
            : 'items-start'
      } group`}
    >
      <div
        className={`max-w-[85%] px-4 py-2.5 rounded-xl break-words ${
          role === 'user'
            ? 'bg-user-bubble rounded-br-sm'
            : role === 'notification'
              ? 'bg-notification-bg border border-notification-border rounded-lg text-[13px] max-w-[90%]'
              : 'bg-assistant-bubble border border-border rounded-bl-sm'
        }`}
      >
        {role === 'user' ? (
          text
        ) : role === 'notification' ? (
          <div className="markdown-content" dangerouslySetInnerHTML={{ __html: `\ud83d\udd14 ${html}` }} />
        ) : (
          <div className="markdown-content" dangerouslySetInnerHTML={{ __html: html! }} />
        )}
      </div>
      {timestamp && (
        <div className="text-[11px] text-text-muted mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {new Date(timestamp).toLocaleString()}
        </div>
      )}
    </div>
  )
}

export function ThinkingIndicator() {
  return (
    <div className="flex flex-col items-start">
      <div className="bg-assistant-bubble border border-border rounded-xl rounded-bl-sm px-4 py-2.5 text-text-muted">
        <div className="flex">
          <span className="thinking-dot">.</span>
          <span className="thinking-dot">.</span>
          <span className="thinking-dot">.</span>
        </div>
      </div>
    </div>
  )
}
