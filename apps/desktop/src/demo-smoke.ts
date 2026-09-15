import type { BrowserWindow } from 'electron'

/** Runs inside the real isolated renderer; verifies both native file IPC and app:// requests. */
export async function runDemoSmoke(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(`(async () => {
    const assert = (ok, message) => { if (!ok) throw new Error(message) }
    assert(location.protocol === 'app:', 'not an app:// renderer')
    assert(typeof require === 'undefined' && typeof process === 'undefined', 'Node globals exposed')
    assert(window.openAlice?.workspace && window.openAlice?.windowChrome, 'preload missing')
    assert(!navigator.serviceWorker.controller, 'Service Worker bypassed desktop transport')
    const runtime = await window.openAlice.runtime.info()
    assert(runtime.transport === 'electron-ipc' && runtime.ports.web === null, 'wrong transport')
    assert(runtime.userDataHome.includes('openalice-demo-'), 'state not isolated')
    const inbox = await fetch('/api/inbox/history').then(r => r.json())
    const entry = inbox.entries.find(e => e.id === 'demo-inbox-power-research')
    assert(entry, 'power report missing')
    const files = await fetch('/api/inbox/' + entry.id + '/files').then(r => r.json())
    assert(files.files.length === 2, 'report/checklist links missing')
    const report = await fetch(files.files[0].href).then(r => r.text())
    assert(report.includes('From AI demand to power delivery'), 'report fetch failed')
    const nativeFile = await window.openAlice.workspace.readFile({ id: entry.workspaceId, path: files.files[0].path })
    assert(nativeFile.kind === 'ok' && nativeFile.content === report, 'native and API files disagree')
    const escape = await window.openAlice.workspace.readFile({ id: entry.workspaceId, path: '../outside.txt' })
    assert(escape.kind === 'invalid_path', 'native file traversal allowed')
    const chat = await fetch('/api/workspaces/' + entry.workspaceId + '/sessions/' + entry.origin.sessionId + '/web').then(r => r.json())
    assert(chat.snapshot.messages.length >= 8, 'linked conversation missing')
    const missing = await fetch('/api/deliberately-unmocked')
    assert(missing.status === 501, 'unmocked API silently succeeded')
    const auth = await fetch('/api/auth/status').then(r => r.json())
    assert(auth.authed === true, 'demo authentication failed')
    const start = Date.now()
    while (!document.querySelector('button') && Date.now() - start < 15000) await new Promise(r => setTimeout(r, 100))
    assert(document.querySelector('button'), 'React UI failed to mount')
  })()`, true)
  console.log('[electron-demo-smoke] PASS app protocol, preload, isolated state, Inbox, report, native files, conversation, fail-closed API, React mount')
}
