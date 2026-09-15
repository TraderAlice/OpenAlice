import { useEffect, useRef, useState } from 'react'

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const boundaries = (text: string) => Array.from(segmenter.segment(text), part => part.index + part.segment.length)

// Reveal whole graphemes (including emoji), and never slice a rich reference.
export function revealPrefix(text: string, count: number, ends = boundaries(text)): string {
  let end = ends[Math.min(count, ends.length) - 1] ?? 0
  for (const match of text.matchAll(/\[\[[\s\S]*?\]\]|!?\[[^\]\n]*\]\([^)]*\)|`[^`\n]*`|\*\*[^*]*\*\*|__[^_]*__|\*\*|__/g)) {
    if (match.index < end && end < match.index + match[0].length) end = match.index
  }
  const prefix = text.slice(0, end)
  // A poll can itself end inside a reference; wait for the closing token.
  const open = prefix.lastIndexOf('[[')
  if (open > prefix.lastIndexOf(']]')) return prefix.slice(0, open)
  const bracket = prefix.lastIndexOf('[')
  if (bracket > prefix.lastIndexOf(']')) return prefix.slice(0, bracket)
  return prefix
}

/** Presentation only: snapshots remain authoritative, including rewrites and Stop. */
export function useTextReveal(text: string, animate: boolean): string {
  const [shown, setShown] = useState(animate ? '' : text)
  const state = useRef({ text, count: animate ? 0 : Infinity })
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let frame = 0
    let previous = performance.now()
    const flush = () => { cancelAnimationFrame(frame); state.current = { text, count: Infinity }; setShown(text) }
    if (!animate || media?.matches) { flush(); return }
    if (!text.startsWith(state.current.text)) state.current.count = 0
    if (!Number.isFinite(state.current.count)) state.current.count = boundaries(state.current.text).length
    state.current.text = text
    const ends = boundaries(text)
    const length = ends.length
    const tick = (now: number) => {
      const elapsed = Math.min(now - previous, 50)
      previous = now
      // Small deltas read naturally; a large batch catches up within ~0.5 s.
      state.current.count = Math.min(length, state.current.count + elapsed * Math.max(0.06, (length - state.current.count) / 300))
      setShown(revealPrefix(text, Math.floor(state.current.count), ends))
      if (state.current.count < length) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const preference = () => { if (media?.matches) flush() }
    media?.addEventListener('change', preference)
    return () => { cancelAnimationFrame(frame); media?.removeEventListener('change', preference) }
  }, [text, animate])
  return animate ? shown : text
}
