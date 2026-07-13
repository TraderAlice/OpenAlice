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
        className="w-16 h-16 rounded-2xl ring-1 ring-accent/25 shadow-[0_0_18px_var(--color-accent-dim)]"
        draggable={false}
      />
      <div className="space-y-2 max-w-md">
        <h2 className="text-base font-semibold text-text">OpenAlice</h2>
        <p className="text-[13px] text-text-muted leading-relaxed">
          Click an icon on the activity bar to open its sidebar, then pick something from the sidebar to open it as a tab.
        </p>
        <p className="text-[12px] text-text-muted/70 leading-relaxed">
          First time here? Open <span className="text-text">Settings → AI Provider</span> to configure a model, then jump back to <span className="text-text">Chat</span>.
        </p>
      </div>
    </div>
  )
}
