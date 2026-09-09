import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** Operates only on the visible message, never reasoning or tool payloads. */
export function MessageActions({ text }: { readonly text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(timer.current) }
  }, [])
  async function copy() {
    clearTimeout(timer.current)
    setState('idle')
    try {
      await navigator.clipboard.writeText(text)
      if (!mounted.current) return
      setState('copied')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setState('idle'), 2000)
    } catch {
      if (mounted.current) setState('failed')
    }
  }
  const label = state === 'copied' ? 'Copied' : 'Copy message'
  return <div className={`conversation-message-actions${state === 'failed' ? ' is-error' : ''}`}>
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} onClick={() => void copy()} />}>
        {state === 'copied' ? <Check aria-hidden /> : <Copy aria-hidden />}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
    {state === 'failed' && <span className="conversation-copy-error" role="alert">Could not copy. Select the message to copy it manually.</span>}
  </div>
}
