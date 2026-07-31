import { useId, useMemo, useState } from 'react'
import { Bot } from 'lucide-react'

import { ConfigSection, Field, SettingsScrollArea, inputClass } from '../components/form'
import { PageHeader } from '../components/PageHeader'
import { SaveIndicator } from '../components/SaveIndicator'
import { useWorkspaces } from '../contexts/workspaces-context'

export function IssueSettingsPage() {
  const { agents, defaultAgent, issueDefaultAgent, setIssueDefaultAgent } = useWorkspaces()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const runtimeSelectId = useId()
  const runtimeDescriptionId = `${runtimeSelectId}-description`

  const runtimeAgents = useMemo(
    () => agents.filter((agent) => agent.kind !== 'utility'),
    [agents],
  )
  const installationDefault = defaultAgent
    ? runtimeAgents.find((agent) => agent.id === defaultAgent)
    : null

  const save = async (next: string | null) => {
    setStatus('saving')
    try {
      await setIssueDefaultAgent(next)
      setStatus('saved')
      window.setTimeout(() => setStatus('idle'), 1800)
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Issue Settings"
        description="Defaults for scheduled issue runs and issue-owned headless work."
      />
      <SettingsScrollArea className="px-4 py-6 md:px-8">
        <div className="mx-auto max-w-[880px]">
          <ConfigSection
            title="Default agent runtime"
            description="Used when an issue does not set its own agent frontmatter. Explicit issue runtime overrides still win."
          >
            <Field
              label="Agent runtime"
              controlId={runtimeSelectId}
              descriptionId={runtimeDescriptionId}
              description={
                installationDefault
                  ? `Unset uses each target Workspace's Session default, then the Alice fallback (${installationDefault.displayName}), then the first registered runtime.`
                  : "Unset uses each target Workspace's Session default, then the first registered runtime."
              }
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Bot
                    size={14}
                    aria-hidden
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
                  />
                  <select
                    id={runtimeSelectId}
                    aria-describedby={runtimeDescriptionId}
                    value={issueDefaultAgent ?? ''}
                    disabled={status === 'saving'}
                    onChange={(event) => void save(event.target.value || null)}
                    className={`${inputClass} pl-9`}
                  >
                    <option value="">Use each Workspace default</option>
                    {runtimeAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.displayName}{agent.installed === false ? ' (missing)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <SaveIndicator status={status} />
              </div>
            </Field>
          </ConfigSection>
        </div>
      </SettingsScrollArea>
    </div>
  )
}
