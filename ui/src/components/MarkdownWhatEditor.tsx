import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface MarkdownWhatEditorProps {
  value: string
  /** Returns true only after the server has accepted this exact Markdown. */
  onSave: (what: string) => Promise<boolean>
}

const AUTOSAVE_DELAY_MS = 800
const SAVED_LABEL_MS = 1_200

/**
 * Linear-style always-editable Issue body. Tiptap owns the visual surface while
 * Markdown remains the persisted/API representation.
 *
 * Autosave is intentionally a small serial queue rather than one request per
 * editor update. While one write is in flight, newer edits replace the queued
 * candidate; the stale response can acknowledge its own snapshot but can never
 * overwrite what the human is currently typing. Incoming poll/write snapshots
 * are only applied when there are no local edits waiting to be saved.
 */
export function MarkdownWhatEditor({ value, onSave }: MarkdownWhatEditorProps) {
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const mountedRef = useRef(true)
  const latestRef = useRef(value)
  const savedRef = useRef(value)
  const saveInFlightRef = useRef(false)
  const saveQueuedRef = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drainRef = useRef<() => Promise<void>>(async () => {})

  const extensions = useMemo(() => [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
    }),
    Markdown.configure({ markedOptions: { breaks: true, gfm: true } }),
  ], [])

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }, [])

  const scheduleSave = useCallback((delay = AUTOSAVE_DELAY_MS) => {
    clearDebounce()
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      void drainRef.current()
    }, delay)
  }, [clearDebounce])

  const editor = useEditor({
    extensions,
    content: value,
    contentType: 'markdown',
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => {
      latestRef.current = current.getMarkdown()
      saveQueuedRef.current = latestRef.current.trim() !== savedRef.current.trim()
      setSaveState(saveQueuedRef.current ? 'dirty' : 'idle')
      if (saveQueuedRef.current) scheduleSave()
      else clearDebounce()
    },
    onBlur: () => {
      if (!saveQueuedRef.current) return
      clearDebounce()
      void drainRef.current()
    },
    editorProps: {
      attributes: {
        'aria-label': 'Issue What',
        spellcheck: 'true',
      },
    },
  })

  const drainSave = useCallback(async () => {
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true
      return
    }

    const candidate = latestRef.current.trim()
    if (!candidate || candidate === savedRef.current.trim()) {
      saveQueuedRef.current = false
      if (mountedRef.current) setSaveState('idle')
      return
    }

    saveInFlightRef.current = true
    saveQueuedRef.current = false
    if (mountedRef.current) setSaveState('saving')

    const saved = await onSave(candidate)
    if (saved) savedRef.current = candidate

    saveInFlightRef.current = false
    const changedWhileSaving = latestRef.current.trim() !== candidate
    const hasUnsavedEdits = latestRef.current.trim() !== savedRef.current.trim()
    saveQueuedRef.current = hasUnsavedEdits

    if (!mountedRef.current) return
    if (changedWhileSaving) {
      setSaveState(saved ? 'dirty' : 'error')
      // If the debounce already fired during the request, the newest snapshot
      // still needs a turn. A short delay also avoids hammering a failing API.
      scheduleSave(saved ? 0 : AUTOSAVE_DELAY_MS)
      return
    }

    if (!saved) {
      setSaveState('error')
      return
    }

    setSaveState('saved')
    if (savedLabelTimerRef.current) clearTimeout(savedLabelTimerRef.current)
    savedLabelTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setSaveState('idle')
    }, SAVED_LABEL_MS)
  }, [onSave, scheduleSave])

  drainRef.current = drainSave

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearDebounce()
      if (savedLabelTimerRef.current) clearTimeout(savedLabelTimerRef.current)
    }
  }, [clearDebounce])

  useEffect(() => {
    if (!editor) return

    const incoming = value.trim()
    const hasLocalEdits = latestRef.current.trim() !== savedRef.current.trim()
    if (saveInFlightRef.current || hasLocalEdits || incoming === savedRef.current.trim()) return

    savedRef.current = value
    latestRef.current = value
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
    setSaveState('idle')
  }, [editor, value])

  const status =
    saveState === 'saving' ? 'Saving…'
      : saveState === 'saved' ? 'Saved'
        : saveState === 'error' ? 'Couldn’t save · will retry after the next edit'
          : ''

  return (
    <div>
      <div className="what-editor-shell rounded-lg border border-transparent transition-colors hover:border-border/40 focus-within:border-border/70 focus-within:bg-bg-secondary/20">
        <EditorContent editor={editor} className="markdown-content what-editor-content" />
      </div>
      <div aria-live="polite" className={`mt-1 min-h-4 text-right text-[11px] transition-opacity ${saveState === 'error' ? 'text-red-400' : 'text-muted/60'} ${status ? 'opacity-100' : 'opacity-0'}`}>
        {status || '\u00a0'}
      </div>
    </div>
  )
}
