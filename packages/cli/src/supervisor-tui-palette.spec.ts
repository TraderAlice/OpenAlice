import { describe, expect, it } from 'vitest'

import {
  SUPERVISOR_TUI_PALETTE,
  supervisorTuiBaseStyle,
  supervisorTuiContrastRatio,
} from './supervisor-tui-palette.ts'

describe('Supervisor TUI palette', () => {
  it('establishes an explicit readable foreground and canvas', () => {
    expect(supervisorTuiBaseStyle()).toBe('\u001b[38;2;216;222;233;48;2;21;23;24m')
    expect(supervisorTuiContrastRatio(
      SUPERVISOR_TUI_PALETTE.text,
      SUPERVISOR_TUI_PALETTE.canvas,
    )).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['muted', SUPERVISOR_TUI_PALETTE.muted, SUPERVISOR_TUI_PALETTE.canvas],
    ['accent', SUPERVISOR_TUI_PALETTE.accent, SUPERVISOR_TUI_PALETTE.canvas],
    ['strong accent', SUPERVISOR_TUI_PALETTE.accentStrong, SUPERVISOR_TUI_PALETTE.canvas],
    ['success', SUPERVISOR_TUI_PALETTE.success, SUPERVISOR_TUI_PALETTE.canvas],
    ['warning', SUPERVISOR_TUI_PALETTE.warning, SUPERVISOR_TUI_PALETTE.canvas],
    ['danger', SUPERVISOR_TUI_PALETTE.danger, SUPERVISOR_TUI_PALETTE.canvas],
    ['selected', SUPERVISOR_TUI_PALETTE.selectedText, SUPERVISOR_TUI_PALETTE.selectedCanvas],
    ['busy rail', SUPERVISOR_TUI_PALETTE.busyText, SUPERVISOR_TUI_PALETTE.busyCanvas],
    ['info rail', SUPERVISOR_TUI_PALETTE.infoText, SUPERVISOR_TUI_PALETTE.infoCanvas],
    ['success rail', SUPERVISOR_TUI_PALETTE.successRailText, SUPERVISOR_TUI_PALETTE.successRailCanvas],
    ['warning rail', SUPERVISOR_TUI_PALETTE.warningRailText, SUPERVISOR_TUI_PALETTE.warningRailCanvas],
    ['danger rail', SUPERVISOR_TUI_PALETTE.dangerRailText, SUPERVISOR_TUI_PALETTE.dangerRailCanvas],
    ['navigation', SUPERVISOR_TUI_PALETTE.navigationText, SUPERVISOR_TUI_PALETTE.navigationCanvas],
    ['navigation hover', SUPERVISOR_TUI_PALETTE.navigationHoverText, SUPERVISOR_TUI_PALETTE.navigationHoverCanvas],
    ['action', SUPERVISOR_TUI_PALETTE.actionText, SUPERVISOR_TUI_PALETTE.actionCanvas],
    ['primary action', SUPERVISOR_TUI_PALETTE.actionPrimaryText, SUPERVISOR_TUI_PALETTE.actionPrimaryCanvas],
    ['dock', SUPERVISOR_TUI_PALETTE.dockText, SUPERVISOR_TUI_PALETTE.dockCanvas],
    ['dock control', SUPERVISOR_TUI_PALETTE.dockControl, SUPERVISOR_TUI_PALETTE.dockCanvas],
    ['dock identity', SUPERVISOR_TUI_PALETTE.dockIdentity, SUPERVISOR_TUI_PALETTE.dockCanvas],
    ['dock success', SUPERVISOR_TUI_PALETTE.dockSuccess, SUPERVISOR_TUI_PALETTE.dockCanvas],
    ['dock warning', SUPERVISOR_TUI_PALETTE.dockWarning, SUPERVISOR_TUI_PALETTE.dockCanvas],
    ['dock danger', SUPERVISOR_TUI_PALETTE.dockDanger, SUPERVISOR_TUI_PALETTE.dockCanvas],
    ['dock panel', SUPERVISOR_TUI_PALETTE.dockPanel, SUPERVISOR_TUI_PALETTE.dockCanvas],
    ...SUPERVISOR_TUI_PALETTE.brandSweep.map((color, index) => (
      [`brand ${index + 1}`, color, SUPERVISOR_TUI_PALETTE.canvas] as const
    )),
  ] as const)('keeps the %s token readable against its owned background', (_, foreground, background) => {
    expect(supervisorTuiContrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })
})
