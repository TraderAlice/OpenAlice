import type { ReactElement } from 'react'

interface DemoTerminalStubProps {
  readonly label: string
}

export function DemoTerminalStub({ label }: DemoTerminalStubProps): ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-8 text-muted-foreground">
      <div className="max-w-md text-left space-y-3">
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
          {label}
        </div>
        <div className="text-base font-semibold text-foreground">
          Agent terminal
        </div>
        <div className="text-sm leading-relaxed text-muted-foreground">
          In a real OpenAlice install, this pane is a live PTY running{' '}
          <span className="text-foreground">Claude Code</span>,{' '}
          <span className="text-foreground">Codex</span>,{' '}
          <span className="text-foreground">opencode</span>,{' '}
          <span className="text-foreground">Pi</span>, or{' '}
          <span className="text-foreground">shell</span> — the AI agent drives it directly: reads files, runs commands, reports back.
        </div>
        <div className="text-xs text-muted-foreground/70">
          Demo mode shows the workspace structure without a live process.
        </div>
        <div className="pt-2">
          <a
            href="https://github.com/TraderAlice/OpenAlice"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-warning hover:underline"
          >
            Install OpenAlice locally →
          </a>
        </div>
      </div>
    </div>
  )
}
