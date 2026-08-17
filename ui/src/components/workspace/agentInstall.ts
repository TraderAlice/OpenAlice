/**
 * Best-effort install guidance for the agent runtime CLIs.
 *
 * The backend (`/api/workspaces/agents`) now reports `installed` per agent by
 * probing the host PATH. When a runtime is missing the picker surfaces this
 * hint so a fresh user knows *what* to install and *how* — the prior behavior
 * was a silent ENOENT at spawn time with no guidance.
 *
 * These commands are a convenience nudge, not a contract: package names can
 * drift, so each entry also carries a docs URL as the authoritative source.
 */
export interface AgentInstallHint {
  /** One-liner the user can paste to install (omitted when uncertain). */
  readonly cmd?: string
  /** Authoritative install/setup docs. */
  readonly url: string
}

export const AGENT_INSTALL: Record<string, AgentInstallHint> = {
  claude: {
    cmd: 'npm install -g @anthropic-ai/claude-code',
    url: 'https://docs.claude.com/en/docs/claude-code/setup',
  },
  codex: {
    cmd: 'npm install -g @openai/codex',
    url: 'https://github.com/openai/codex',
  },
  opencode: {
    cmd: 'npm install -g opencode-ai',
    url: 'https://opencode.ai',
  },
  pi: {
    // pi (earendil-works/pi) — ships the `pi` bin from this package.
    cmd: 'npm install -g @earendil-works/pi-coding-agent',
    url: 'https://github.com/earendil-works/pi',
  },
  cursor: {
    cmd: 'curl https://cursor.com/install -fsS | bash',
    url: 'https://cursor.com/docs/cli/overview',
  },
  agy: {
    cmd: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    url: 'https://www.antigravity.google/docs/cli/install/',
  },
  grok: {
    cmd: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    url: 'https://x.ai/cli',
  },
  omp: {
    cmd: 'curl -fsSL https://omp.sh/install | sh',
    url: 'https://omp.sh/',
  },
}

export function installHintFor(agentId: string): AgentInstallHint | undefined {
  return AGENT_INSTALL[agentId]
}
