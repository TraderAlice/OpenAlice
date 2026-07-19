/**
 * Shown in the main editor area when no tabs are open. Phase-2 minimal:
 * logo + a couple of plain-text pointers so a fresh user knows where to
 * start. The full onboarding system (guided setup, status checks, etc.)
 * is a separate effort that will replace this surface.
 */
export function EmptyEditor() {
  return (
    <div className="flex flex-col items-center justify-center h-full select-none px-6 gap-5 text-center">
      <img
        src="/alice.ico"
        alt="OpenAlice"
        className="w-16 h-16 rounded-2xl ring-1 ring-primary/25 shadow-[0_0_18px_var(--primary-muted)]"
        draggable={false}
      />
      <div className="space-y-2 max-w-md">
        <h2 className="text-base font-semibold text-foreground">OpenAlice</h2>
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          Click an icon on the activity bar to open its sidebar, then pick something from the sidebar to open it as a tab.
        </p>
        <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
          First time here? Open <span className="text-foreground">Settings → AI Provider</span> to configure a model, then jump back to <span className="text-foreground">Chat</span>.
        </p>
      </div>
    </div>
  )
}
