import { Bot, Code2, Cpu, Sparkles, type LucideIcon } from 'lucide-react'

const AGENT_RUNTIME_ICONS: Record<string, LucideIcon> = {
  claude: Sparkles,
  codex: Cpu,
  opencode: Code2,
  pi: Bot,
}

/** Dedicated icons where they exist; otherwise one intentional generic Bot. */
export function agentRuntimeIcon(agentId: string | null | undefined): LucideIcon {
  return (agentId ? AGENT_RUNTIME_ICONS[agentId] : undefined) ?? Bot
}
