import { officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'

export function OfficeWindowControlGlyph({ kind }: { kind: 'back' | 'close' }) {
  if (kind === 'back') {
    return <img src={OFFICE_HUD_ASSETS.windowBack} alt="" aria-hidden style={officePixelImg} />
  }
  return <span className="oa-office-window__close-mark" aria-hidden />
}
