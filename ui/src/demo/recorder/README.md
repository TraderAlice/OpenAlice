# Recording a real PTY transcript

The demo terminal can replay a recorded session if a matching transcript
fixture is registered. To capture one from your live dev environment:

## Steps

1. Run the full app (NOT demo mode):
   ```bash
   pnpm dev
   ```
2. Open the UI at `http://localhost:5173/`. In the browser DevTools console:
   ```js
   __demoRecord.start()
   ```
3. Create a workspace and open a terminal session as normal. Interact —
   type commands, let Claude / Codex / shell respond, do whatever you want
   the demo viewer to see.
4. When you're done, stop and download:
   ```js
   __demoRecord.stop('claude-research-may-2026')   // any label
   ```
   Browser downloads `transcript-claude-research-may-2026-<ts>.json`.
5. Move the JSON into `ui/src/demo/fixtures/transcripts/` and register it
   in `index.ts`:
   ```ts
   import claudeResearch from './claude-research-may-2026.json'
   export const transcriptsByWorkspace: Record<string, Transcript> = {
     [DEMO_WORKSPACE_ID]: claudeResearch as Transcript,
   }
   ```
6. Switch to demo mode (`pnpm -F open-alice-ui dev:demo`) and verify the
   transcript plays back.

## Format

```ts
{
  label: string,
  durationMs: number,
  frames: [{ atMs: number, bytesB64: string }, ...]
}
```

`bytesB64` is base64-encoded raw PTY output bytes — what the server sent
down the WebSocket. The replay player decodes and feeds them straight to
xterm.js via `term.write(uint8array)`. ANSI escapes, cursor moves, and
colors all replay faithfully because they're already in the bytes.

## Caveats

- The recorder only listens to server → client frames. Your typed input
  isn't recorded — that's fine for replay (the terminal shows what the
  user sees, not their keystrokes).
- Don't record sessions that contain secrets — the transcript ships as a
  static asset in the demo bundle. Sanity-check the JSON before
  committing.
- The recorder monkey-patches `window.WebSocket` while active. It only
  taps URLs matching `/api/workspaces/pty`; other WebSocket connections
  (none today, but future-proofing) are passed through unchanged.
