import antigravityIcon from '@lobehub/icons-static-svg/icons/antigravity-color.svg'
import claudeIcon from '@lobehub/icons-static-svg/icons/claude-color.svg'
import codexIcon from '@lobehub/icons-static-svg/icons/codex.svg'
import cursorIcon from '@lobehub/icons-static-svg/icons/cursor.svg'
import grokIcon from '@lobehub/icons-static-svg/icons/grok.svg'
import opencodeIcon from '@lobehub/icons-static-svg/icons/opencode.svg'
import piIcon from '@lobehub/icons-static-svg/icons/pi.svg'
import { Bot } from 'lucide-react'

import ompIcon from '../assets/agent-runtimes/omp.svg'

interface AgentRuntimeIconProps {
  readonly agentId: string | null | undefined
  readonly className?: string
}

interface BrandAsset {
  readonly src: string
  readonly monochrome?: boolean
}

const AGENT_RUNTIME_BRANDS: Record<string, BrandAsset> = {
  claude: { src: claudeIcon },
  codex: { src: codexIcon, monochrome: true },
  cursor: { src: cursorIcon, monochrome: true },
  agy: { src: antigravityIcon },
  grok: { src: grokIcon, monochrome: true },
  omp: { src: ompIcon },
  opencode: { src: opencodeIcon, monochrome: true },
  pi: { src: piIcon, monochrome: true },
}

/** Official runtime identity where available; unknown extensions keep a safe generic fallback. */
export function AgentRuntimeIcon({ agentId, className }: AgentRuntimeIconProps) {
  const brand = agentId ? AGENT_RUNTIME_BRANDS[agentId] : undefined
  if (!brand) return <Bot aria-hidden data-agent-runtime-icon={agentId ?? 'generic'} className={className} />

  if (brand.monochrome) {
    const mask = `url("${brand.src}") center / contain no-repeat`
    return (
      <span
        aria-hidden
        data-agent-runtime-icon={agentId}
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
      data-agent-runtime-icon={agentId}
      draggable={false}
      className={`${className ?? ''} object-contain`}
    />
  )
}
