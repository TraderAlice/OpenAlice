import { Bot, Plus, Repeat2, UserRound } from 'lucide-react'

/** Assignment identity stays independent of execution health. */
export function IssueAssigneeAvatar({ value }: { value: string }) {
  const bound = value.startsWith('@resume-')
  const human = value === '@human'
  const eachRun = value === '@new-each-run'
  const newSession = value === '@new-then-resume'
  return <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        {bound || human ? <span className="flex size-5 items-center justify-center rounded-full bg-muted-foreground text-background">
          {bound ? <Bot size={13} aria-hidden /> : <UserRound size={13} aria-hidden />}
        </span> : eachRun || newSession ? <span className="flex size-5 items-center justify-center rounded-full border border-dashed border-current">
          {eachRun ? <Repeat2 size={12} aria-hidden /> : <Plus size={12} aria-hidden />}
        </span> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="1.5 4" strokeLinecap="round" />
          <circle cx="12" cy="10" r="3" fill="currentColor" />
          <path d="M5.5 18.3a7.5 7.5 0 0 1 13 0M6 19a9 9 0 0 0 12 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>}
  </span>
}
