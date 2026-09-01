import anthropicIcon from '@lobehub/icons-static-svg/icons/anthropic.svg'
import cursorIcon from '@lobehub/icons-static-svg/icons/cursor.svg'
import deepseekIcon from '@lobehub/icons-static-svg/icons/deepseek-color.svg'
import geminiIcon from '@lobehub/icons-static-svg/icons/gemini-color.svg'
import longcatIcon from '@lobehub/icons-static-svg/icons/longcat-color.svg'
import minimaxIcon from '@lobehub/icons-static-svg/icons/minimax-color.svg'
import moonshotIcon from '@lobehub/icons-static-svg/icons/moonshot.svg'
import openaiIcon from '@lobehub/icons-static-svg/icons/openai.svg'
import openrouterIcon from '@lobehub/icons-static-svg/icons/openrouter-color.svg'
import xaiIcon from '@lobehub/icons-static-svg/icons/xai.svg'
import zhipuIcon from '@lobehub/icons-static-svg/icons/zhipu-color.svg'
import { KeyRound } from 'lucide-react'

interface AIProviderIconProps {
  readonly vendor: string | null | undefined
  readonly className?: string
}

interface BrandAsset {
  readonly src: string
  readonly monochrome?: boolean
}

const AI_PROVIDER_BRANDS: Record<string, BrandAsset> = {
  anthropic: { src: anthropicIcon, monochrome: true },
  openai: { src: openaiIcon, monochrome: true },
  google: { src: geminiIcon },
  xai: { src: xaiIcon, monochrome: true },
  minimax: { src: minimaxIcon },
  glm: { src: zhipuIcon },
  kimi: { src: moonshotIcon, monochrome: true },
  deepseek: { src: deepseekIcon },
  longcat: { src: longcatIcon, monochrome: true },
  openrouter: { src: openrouterIcon },
  cursor: { src: cursorIcon, monochrome: true },
}

/** Official provider identity where available; custom endpoints use a neutral credential glyph. */
export function AIProviderIcon({ vendor, className }: AIProviderIconProps) {
  const brand = vendor ? AI_PROVIDER_BRANDS[vendor] : undefined
  if (!brand) return <KeyRound aria-hidden data-ai-provider-icon={vendor ?? 'custom'} className={className} />

  if (brand.monochrome) {
    const mask = `url("${brand.src}") center / contain no-repeat`
    return (
      <span
        aria-hidden
        data-ai-provider-icon={vendor}
        className={`${className ?? ''} inline-block bg-current`}
        style={{ mask, WebkitMask: mask }}
      />
    )
  }

  return (
    <img
      src={brand.src}
      alt=""
      aria-hidden
      data-ai-provider-icon={vendor}
      draggable={false}
      className={`${className ?? ''} object-contain`}
    />
  )
}
