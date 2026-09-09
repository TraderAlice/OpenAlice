import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceSkill } from '../../hooks/useWorkspaceCapabilities'
import { useWorkspaceMirror } from '../../hooks/useWorkspaceMirrors'
import { Button } from '../ui/button'

function Comparison({
  wsId,
  source,
  mirror,
  label,
  instructions,
}: {
  wsId: string
  source: string
  mirror: string
  label: string
  instructions: boolean
}) {
  const { t } = useTranslation()
  const state = useWorkspaceMirror(wsId, source, mirror, instructions)
  const [selected, select] = useState<string>()
  const differences = state?.differences ?? []
  const uncertain =
    state?.failed || differences.some((d) => d.status === 'unchecked')
  const status = !state
    ? 'checking'
    : uncertain
      ? 'unchecked'
      : differences.length
        ? 'changed'
        : 'equal'
  const file = differences.find((d) => d.path === selected)
  return (
    <details className="cap-mirror">
      <summary>
        <span>
          {label} {t('mirrors.mirror')}
        </span>
        <span className={`cap-mirror-status ${status}`} role="status">
          {t(`mirrors.${status}`)}
        </span>
      </summary>
      <code className="cap-path">{mirror}</code>
      <p className="cap-note">{t('mirrors.scope')}</p>
      {differences.map((d) => (
        <Button
          key={d.path}
          variant="ghost"
          size="sm"
          onClick={() => select(d.path)}
          aria-pressed={selected === d.path}
        >
          {d.path} · {t(`mirrors.${d.status}`)}
        </Button>
      ))}
      {file && (
        <div className="cap-mirror-diff">
          {(['source', 'mirror'] as const).map((side) => (
            <section key={side}>
              <h3>{t(`mirrors.${side}`)}</h3>
              <pre className="cap-source">
                {file[side]?.kind === 'text'
                  ? file[side]?.content
                  : t(
                      `mirrors.${!file[side] ? 'absent' : file[side]?.kind === 'directory' ? 'directory' : 'unchecked'}`,
                    )}
              </pre>
            </section>
          ))}
        </div>
      )}
    </details>
  )
}

export function MirrorDetails({
  wsId,
  skill,
  instructions,
}: {
  wsId: string
  skill: WorkspaceSkill
  instructions: boolean
}) {
  const { t } = useTranslation()
  const source = instructions ? 'AGENTS.md' : `.agents/skills/${skill.name}`
  return (
    <div className="cap-mirrors">
      <p className="cap-note">
        {t(
          skill.source === 'mirror-only' || skill.source === 'legacy'
            ? 'mirrors.noSource'
            : skill.source === 'unchecked'
              ? 'mirrors.unchecked'
              : 'mirrors.primaryHint',
        )}
      </p>
      {skill.mirrors?.map((m) =>
        m.present === false ? (
          <div className="cap-mirror-summary" key={m.path}>
            <span>
              {m.label} {t('mirrors.mirror')}
            </span>
            <span>{t('mirrors.absent')}</span>
          </div>
        ) : m.present === undefined ? (
          <div key={m.path} role="status">
            {m.label} · {t('mirrors.unchecked')}
          </div>
        ) : (
          <Comparison
            key={m.path}
            wsId={wsId}
            source={source}
            mirror={m.path}
            label={m.label === 'Pi' ? `Pi · ${t('mirrors.legacy')}` : m.label}
            instructions={instructions}
          />
        ),
      )}
    </div>
  )
}
