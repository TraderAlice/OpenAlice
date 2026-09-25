import { type ReactNode, type RefObject } from 'react'
import { ArrowUp, LoaderCircle, Square } from 'lucide-react'
import { Textarea } from '../ui/textarea'
import './conversation.css'
import { Button } from '../ui/button'
import { ComposerShell } from './ComposerShell'

export interface ChatComposerProps {
  value: string; onChange(value: string): void; onSubmit(): void;
  placeholder: string; disabled?: boolean; canSend: boolean;
  pending?: boolean; busy?: boolean; onStop?: (() => void) | undefined;
  stopLabel?: string; sendLabel?: string;
  context?: ReactNode; controls?: ReactNode; details?: ReactNode;
  inputRef?: RefObject<HTMLTextAreaElement | null>; autoFocus?: boolean;
}

/** Shared input and actions for both a new task and an existing conversation. */
export function ChatComposer({ value, onChange, onSubmit, placeholder, disabled, canSend,
  pending = false, busy = false, onStop, stopLabel = 'Stop response', sendLabel = 'Send message',
  context, controls, details, inputRef, autoFocus,
}: ChatComposerProps) {
  return <ComposerShell context={context} controls={controls} details={details} action={
    busy ? onStop && <Button size="icon" className="conversation-send" disabled={pending} aria-label={stopLabel} onClick={onStop}>
      {pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Square size={14} fill="currentColor" aria-hidden />}
    </Button> : <Button size="icon" className="conversation-send" disabled={!canSend || pending} aria-label={sendLabel} aria-busy={pending} onClick={onSubmit}>
      {pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <ArrowUp size={18} aria-hidden />}
    </Button>
  }>
    <Textarea ref={inputRef} value={value} rows={1} aria-label={placeholder} placeholder={placeholder}
      autoFocus={autoFocus} disabled={disabled} onChange={event => onChange(event.target.value)}
      className="conversation-input"
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          if (canSend && !pending && !busy) onSubmit()
        }
      }} />
  </ComposerShell>
}
