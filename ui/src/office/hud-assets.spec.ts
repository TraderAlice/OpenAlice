import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { OFFICE_HUD_ASSETS } from './hud-assets'

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10]
const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')

describe('OFFICE_HUD_ASSETS', () => {
  it('ships generated RGBA pixel controls', () => {
    expect(OFFICE_HUD_ASSETS.menuTerminal).toBe('/office/hud/menu-terminal-v2.png')
    expect(OFFICE_HUD_ASSETS.movePad).toBe('/office/hud/move-pad-v2.png')
    expect(OFFICE_HUD_ASSETS.resetCompass).toBe('/office/hud/reset-compass-v2.png')
    expect(OFFICE_HUD_ASSETS.groupGrid).toBe('/office/hud/group-grid-v2.png')
    expect(OFFICE_HUD_ASSETS.occupancyLog).toBe('/office/hud/occupancy-log-v2.png')
    expect(OFFICE_HUD_ASSETS.signalReceiver).toBe('/office/hud/signal-receiver-v2.png')
    expect(OFFICE_HUD_ASSETS.rosterBadge).toBe('/office/hud/roster-badge-v2.png')
    expect(OFFICE_HUD_ASSETS.windowClose).toBe('/office/hud/window-close-v2.png')
    expect(OFFICE_HUD_ASSETS.sessionPortal).toBe('/office/hud/session-portal-v2.png')
    expect(OFFICE_HUD_ASSETS.drawerRecord).toBe('/office/hud/drawer-record-v2.png')
    expect(OFFICE_HUD_ASSETS.talkBubble).toBe('/office/hud/talk-bubble-v2.png')
    expect(OFFICE_HUD_ASSETS.windowBack).toBe('/office/hud/window-back-v2.png')

    for (const url of Object.values(OFFICE_HUD_ASSETS)) {
      const bytes = readFileSync(resolve(publicRoot, url.replace(/^\//, '')))
      expect([...bytes.subarray(0, 8)]).toEqual(PNG_MAGIC)
      expect(bytes[25]).toBe(6) // PNG color type 6: RGBA.
      expect(bytes.byteLength).toBeGreaterThan(1000)
      expect(bytes.readUInt32BE(16)).toBe(48)
      expect(bytes.readUInt32BE(20)).toBe(48)
    }
  })
})
