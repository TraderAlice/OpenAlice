import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
  // Exercise the actual menu through the owner preload, not a renderer-only mock.
  const pet = BrowserWindow.getAllWindows().find(window => window !== win && window.getTitle() === 'Alice')
  if (!pet) throw new Error('Companion window missing')
  await win.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate) => {
      const start = Date.now(); while (!predicate()) {
        if (Date.now() - start > 5000) throw new Error('Companion menu not ready');
        await new Promise(r => setTimeout(r, 50));
      }
    };
    await wait(() => document.querySelector('.oa-application-menu'));
    document.querySelector('.oa-application-menu').click();
    const row = () => [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent === 'Hide pet');
    await wait(row); row().click();
    await wait(() => !document.querySelector('[role="menuitem"]'));
    const hiddenStart = Date.now();
    while (await window.openAlice.companion.getVisible()) {
      if (Date.now() - hiddenStart > 5000) throw new Error('Companion did not hide');
      await new Promise(r => setTimeout(r, 25));
    }
  })()`, true)
  if (pet.isVisible()) throw new Error('Menu failed to hide native companion')
  await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('.oa-application-menu').click();
    const start = Date.now(); let row;
    while (!(row = [...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent === 'Show pet'))) {
      if (Date.now() - start > 5000) throw new Error('Show pet recovery entry missing');
      await new Promise(r => setTimeout(r, 50));
    }
    row.click();
    while (!(await window.openAlice.companion.getVisible())) {
      if (Date.now() - start > 5000) throw new Error('Companion did not show');
      await new Promise(r => setTimeout(r, 25));
    }
  })()`, true)
  if (!pet.isVisible()) throw new Error('Menu failed to restore native companion')
  console.log('[electron-demo-smoke] PASS Alice Settings native companion hide/show recovery')
  // Import a generated silent WAV through the real Settings file input. No bundled asset.
  const wav = Buffer.alloc(1644)
  wav.write('RIFF'); wav.writeUInt32LE(1636, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(1600, 40)
  await win.loadURL('app://openalice/settings/pet')
  await win.webContents.executeJavaScript(`(async () => {
    const start = Date.now();
    while (!document.querySelector('input[type="file"]')) {
      if (Date.now()-start>10000) throw new Error('Pet settings route missing');
      await new Promise(r=>setTimeout(r,50));
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(wav.toString('base64'))}), c=>c.charCodeAt(0))], 'smoke-click.wav', {type:'audio/wav'}));
    const input=document.querySelector('input[type="file"]'); input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    while ((await window.openAlice.companion.getSound()).source?.name !== 'smoke-click.wav') {
      if (Date.now()-start>15000) throw new Error('Pet audio import failed: '+document.body.innerText);
      await new Promise(r=>setTimeout(r,50));
    }
    const preview=[...document.querySelectorAll('button')].find(el=>el.textContent==='Preview');
    if (!preview || preview.disabled) throw new Error('Audio preview unavailable');
    preview.click();
  })()`, true)
  await pet.webContents.executeJavaScript(`(async () => {
    const start=Date.now();
    while (!clickAudio) { if(Date.now()-start>5000) throw new Error('Sound did not reach pet'); await new Promise(r=>setTimeout(r,25)); }
    pet.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    while (!clickAudio.ended) { if(Date.now()-start>5000) throw new Error('Click sound did not play'); await new Promise(r=>setTimeout(r,25)); }
  })()`)
  await win.webContents.executeJavaScript(`window.openAlice.companion.updateSound({enabled:false, volume:.2})`)
  await pet.webContents.executeJavaScript(`(async () => {
    const start=Date.now(); while(sound.enabled) { if(Date.now()-start>5000) throw new Error('Mute did not synchronize'); await new Promise(r=>setTimeout(r,25)); }
    let played=false; clickAudio.addEventListener('play',()=>played=true,{once:true});
    pet.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await new Promise(r=>setTimeout(r,150)); if(played) throw new Error('Muted pet played audio');
  })()`)
  await win.webContents.executeJavaScript(`(async () => {
    const reset=[...document.querySelectorAll('button')].find(el=>el.textContent==='Restore defaults');
    reset.click(); const start=Date.now();
    while((await window.openAlice.companion.getSound()).source?.name !== 'OpenAlice default (Soft double).wav') {
      if(Date.now()-start>5000) throw new Error('Reset failed');
      await new Promise(r=>setTimeout(r,25));
    }
  })()`, true)
  console.log('[electron-demo-smoke] PASS Pet settings import, preview, native playback, mute and reset')
  await win.webContents.executeJavaScript(`(async () => {
    const p=await window.openAlice.companion.activity.getPreferences();
    if(!p.events.completion||!p.events.failure||!p.events.action||!p.events.news||p.events.progress||!p.brief) throw new Error('Official notification defaults missing');
    await window.openAlice.companion.activity.updatePreferences({events:{...p.events,news:false}});
    if((await window.openAlice.companion.activity.getPreferences()).events.news!==false) throw new Error('Preference save failed');
    await window.openAlice.companion.activity.resetPreferences();
  })()`)
  writeFileSync(join(app.getPath('userData'), 'notifications-settings.png'), (await win.webContents.capturePage()).toPNG())
  win.hide()
  await win.webContents.executeJavaScript(`fetch('/api/agent-runtime/sonner-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:'success'})})`)
  const activityStart = Date.now()
  while (!await pet.webContents.executeJavaScript(`!!activityId`)) {
    if (Date.now()-activityStart>10_000) throw new Error('Journal did not reach background pet')
    await new Promise(done=>setTimeout(done,100))
  }
  const bubbleState = await pet.webContents.executeJavaScript(`({text:message.textContent,actions:!activityActions.hidden,connected:typeof require==='undefined',outside:activityHit({x:0,y:0})})`)
  if(bubbleState.text!=='Work completed'||!bubbleState.actions||!bubbleState.connected||bubbleState.outside) throw new Error('Privacy or bubble hit bounds failed')
  writeFileSync(join(app.getPath('userData'), 'notification-pet.png'), (await pet.webContents.capturePage()).toPNG())
  await pet.webContents.executeJavaScript(`document.querySelector('#activity-open').click()`)
  const openStart = Date.now()
  while(!win.isVisible()) { if(Date.now()-openStart>5000) throw new Error('Bubble did not open main'); await new Promise(done=>setTimeout(done,50)) }
  if(await pet.webContents.executeJavaScript(`!!activityId`)) throw new Error('Foreground transition left duplicate bubble')
  console.log('[electron-demo-smoke] PASS notification defaults/save/reset, real Journal IPC to background bubble, privacy/hit bounds and safe Open without duplicate')

}
