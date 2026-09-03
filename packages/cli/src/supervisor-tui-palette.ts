export type SupervisorTuiRgb = readonly [red: number, green: number, blue: number]

export interface SupervisorTuiPalette {
  canvas: SupervisorTuiRgb
  text: SupervisorTuiRgb
  accent: SupervisorTuiRgb
  accentStrong: SupervisorTuiRgb
  muted: SupervisorTuiRgb
  success: SupervisorTuiRgb
  warning: SupervisorTuiRgb
  danger: SupervisorTuiRgb
  selectedText: SupervisorTuiRgb
  selectedCanvas: SupervisorTuiRgb
  busyText: SupervisorTuiRgb
  busyCanvas: SupervisorTuiRgb
  infoText: SupervisorTuiRgb
  infoCanvas: SupervisorTuiRgb
  successRailText: SupervisorTuiRgb
  successRailCanvas: SupervisorTuiRgb
  warningRailText: SupervisorTuiRgb
  warningRailCanvas: SupervisorTuiRgb
  dangerRailText: SupervisorTuiRgb
  dangerRailCanvas: SupervisorTuiRgb
  navigationText: SupervisorTuiRgb
  navigationCanvas: SupervisorTuiRgb
  navigationHoverText: SupervisorTuiRgb
  navigationHoverCanvas: SupervisorTuiRgb
  actionText: SupervisorTuiRgb
  actionCanvas: SupervisorTuiRgb
  actionPrimaryText: SupervisorTuiRgb
  actionPrimaryCanvas: SupervisorTuiRgb
  dockText: SupervisorTuiRgb
  dockCanvas: SupervisorTuiRgb
  dockControl: SupervisorTuiRgb
  dockIdentity: SupervisorTuiRgb
  dockSuccess: SupervisorTuiRgb
  dockWarning: SupervisorTuiRgb
  dockDanger: SupervisorTuiRgb
  dockPanel: SupervisorTuiRgb
  brandSweep: readonly SupervisorTuiRgb[]
}

export const SUPERVISOR_TUI_PALETTE: SupervisorTuiPalette = {
  canvas: [21, 23, 24],
  text: [216, 222, 233],
  accent: [92, 220, 211],
  accentStrong: [116, 235, 226],
  muted: [116, 132, 153],
  success: [89, 214, 145],
  warning: [245, 190, 83],
  danger: [255, 107, 129],
  selectedText: [230, 255, 252],
  selectedCanvas: [24, 64, 69],
  busyText: [183, 255, 248],
  busyCanvas: [12, 42, 45],
  infoText: [189, 229, 255],
  infoCanvas: [17, 35, 52],
  successRailText: [170, 255, 207],
  successRailCanvas: [13, 45, 31],
  warningRailText: [255, 222, 151],
  warningRailCanvas: [54, 40, 16],
  dangerRailText: [255, 190, 201],
  dangerRailCanvas: [55, 20, 31],
  navigationText: [162, 190, 198],
  navigationCanvas: [11, 28, 34],
  navigationHoverText: [203, 250, 246],
  navigationHoverCanvas: [19, 49, 55],
  actionText: [173, 202, 208],
  actionCanvas: [13, 31, 38],
  actionPrimaryText: [183, 255, 248],
  actionPrimaryCanvas: [18, 54, 59],
  dockText: [199, 235, 239],
  dockCanvas: [10, 34, 39],
  dockControl: [183, 255, 248],
  dockIdentity: [240, 249, 255],
  dockSuccess: [145, 242, 187],
  dockWarning: [255, 214, 128],
  dockDanger: [255, 151, 169],
  dockPanel: [213, 179, 255],
  brandSweep: [
    [116, 235, 226],
    [92, 220, 211],
    [111, 198, 255],
    [168, 166, 255],
    [226, 156, 255],
    [255, 164, 210],
  ],
}

function rgb(color: SupervisorTuiRgb): string {
  return color.join(';')
}

export function supervisorTuiAnsiStyle(
  foreground: SupervisorTuiRgb,
  options: { bold?: boolean, background?: SupervisorTuiRgb } = {},
): string {
  const codes = [
    ...(options.bold ? ['1'] : []),
    '38',
    '2',
    rgb(foreground),
    ...(options.background ? ['48', '2', rgb(options.background)] : []),
  ]
  return `\u001b[${codes.join(';')}m`
}

export function supervisorTuiBaseStyle(
  palette: SupervisorTuiPalette = SUPERVISOR_TUI_PALETTE,
): string {
  return supervisorTuiAnsiStyle(palette.text, { background: palette.canvas })
}

function relativeLuminance(color: SupervisorTuiRgb): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
}

export function supervisorTuiContrastRatio(
  foreground: SupervisorTuiRgb,
  background: SupervisorTuiRgb,
): number {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}
