/** Isolated native companion acceptance; no Guardian, credentials, or broker. */
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { createCompanion } from './companion.js'

const home = mkdtempSync(join(tmpdir(), 'openalice-companion-'))
app.setPath('userData', home)
app.on('window-all-closed', () => app.quit())
void app.whenReady().then(async () => {
  const owner = new BrowserWindow({ show: false, width: 900, height: 700 })
  const pet = createCompanion(owner)!.window
  pet.webContents.on('preload-error', (_event, path, error) => console.error(path, error))
  pet.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message) })
  await new Promise<void>((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Companion did not become visible')), 15000)
    pet.once('show', () => { clearTimeout(timeout); done() })
  })
  console.log(`[companion-preview] ready; isolated profile: ${home}`)
  if (!process.argv.includes('--smoke')) return
  const info = await pet.webContents.executeJavaScript(`({bridge: !!window.companion, node: typeof require, alpha: alpha.data[3], width: alpha.width, transition: getComputedStyle(body).transition, origin: getComputedStyle(body).transformOrigin})`)
  assert.equal(info.bridge, true)
  assert.equal(info.node, 'undefined')
  assert.equal(info.alpha, 0)
  assert.equal(info.width, 1254)
  const bubbleAlpha = await pet.webContents.executeJavaScript(`(() => {
    const img = document.querySelector('#bubble img');
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    return [ctx.getImageData(0, 0, 1, 1).data[3],
      ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data[3]];
  })()`)
  assert.equal(bubbleAlpha[0], 0, 'Speech bubble exterior must be transparent')
  assert.ok(bubbleAlpha[1] >= 250, 'Speech bubble interior must be effectively opaque')
  assert.equal(pet.isAlwaysOnTop(), true)
  pet.focus()
  await new Promise(done => setTimeout(done, 150))
  await pet.webContents.executeJavaScript(`window.smokeEvents=[]; for(const name of ['pointerdown','pointerup','pointercancel','lostpointercapture','blur']) window.addEventListener(name, e => window.smokeEvents.push([name,e.clientX,e.clientY]),true)`)
  const box = await pet.webContents.executeJavaScript(`(() => { const r=portrait.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height*.6)} })()`)
  pet.webContents.sendInputEvent({ type: 'mouseDown', ...box, button: 'left', clickCount: 1 })
  await new Promise(done => setTimeout(done, 280))
  assert.equal(await pet.webContents.executeJavaScript(`body.classList.contains('pressed')`), true)
  writeFileSync(join(home, 'pressed.png'), (await pet.webContents.capturePage()).toPNG())
  pet.webContents.sendInputEvent({ type: 'mouseUp', ...box, button: 'left', clickCount: 1 })
  await new Promise(done => setTimeout(done, 650))
  assert.equal(await pet.webContents.executeJavaScript(`bubble.classList.contains('open')`), true,
    await pet.webContents.executeJavaScript(`JSON.stringify({events:window.smokeEvents,held,pressed:body.className})`))
  assert.equal(await pet.webContents.executeJavaScript(`body.classList.contains('pressed')`), false)
  const expectedLines = ['Curiouser and curiouser!', 'What a curious feeling!',
    'Do cats eat bats?', 'I’m growing.', 'There’s plenty of room!',
    'Yes, please do!', 'Nonsense!', 'I won’t!']
  assert.equal(await pet.webContents.executeJavaScript(`message.textContent`), expectedLines[0])
  for (let i = 1; i <= expectedLines.length; i++) {
    const text = await pet.webContents.executeJavaScript(`(() => {
      pet.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
      return message.textContent;
    })()`)
    assert.equal(text, expectedLines[i % expectedLines.length], 'Dialogue must cycle through all eight English lines')
  }
  writeFileSync(join(home, 'bubble.png'), (await pet.webContents.capturePage()).toPNG())
  // A light renderer backdrop exposes outline/tail placement hidden by dark previews.
  await pet.webContents.executeJavaScript(`document.documentElement.style.backgroundColor = '#f5f5f5'`)
  await new Promise(done => setTimeout(done, 50))
  writeFileSync(join(home, 'bubble-light.png'), (await pet.webContents.capturePage()).toPNG())
  pet.webContents.send('openalice:companion:flip', true)
  await new Promise(done => setTimeout(done, 350))
  assert.equal(await pet.webContents.executeJavaScript(`mirror.classList.contains('flipped')`), true)
  writeFileSync(join(home, 'flipped.png'), (await pet.webContents.capturePage()).toPNG())
  // Window gutters must preserve portrait size and contain the bubble on both sides.
  for (const size of [170, 220, 280]) {
    pet.setSize(Math.round(size * 2.7), Math.round(size * 1.65))
    for (const flipped of [false, true]) {
      pet.webContents.send('openalice:companion:flip', flipped)
      await new Promise(done => setTimeout(done, 350))
      const layout = await pet.webContents.executeJavaScript(`(() => {
        const b = bubble.getBoundingClientRect(), p = portrait.getBoundingClientRect();
        return {left:b.left, right:b.right, viewport:innerWidth, portrait:p.width,
          offset:(b.left+b.right-p.left-p.right)/2, top:b.top, height:innerHeight};
      })()`)
      assert.ok(layout.left >= -1 && layout.right <= layout.viewport + 1, 'Bubble clipped')
      assert.ok(Math.abs(layout.portrait - size * .9) < 1, 'Portrait size changed')
      assert.ok(Math.abs(layout.offset - size * .8 * (flipped ? 1 : -1)) < 1, 'Bubble offset changed')
      assert.ok(Math.abs(layout.top - (layout.height * .26 - 55)) < 1, 'Bubble must sit above-left of Alice')
      assert.ok(layout.top >= 0, 'Raised bubble must remain inside the window')
    }
  }
  console.log('[companion-preview] smoke passed', JSON.stringify(info))
  owner.destroy()
  assert.equal(pet.isDestroyed(), true)
}).catch(error => { console.error(error); app.exit(1) })
