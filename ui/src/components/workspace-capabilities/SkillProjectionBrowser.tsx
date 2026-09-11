import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react'
import { useSkillProjection, type ProjectInjection, type SkillProjection } from '../../hooks/useProjectInjection'
import type { SkillProjectionRequest } from '../workspace/api'
import { WorkspaceTemplateUpgradePanel } from '../workspace/WorkspaceTemplateUpgradePanel'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../ui/dropdown-menu'

export function skillProjectionStatus(skill: SkillProjection) {
  if (skill.files.some((file) => file.unverified)) return 'unverified'
  if (!skill.installed) return 'notInstalled'
  if (!skill.canonicalPresent) return 'missingPrimary'
  if (!skill.files.some((file) => file.differs)) return 'matches'
  if (skill.customized) return 'customized'
  return 'updateAvailable'
}

export function InjectionVersion({ version, empty, date }: { version?: string | null; empty: string; date?: string | null }) {
  if (!version || version === 'unversioned') return <span className="text-xs text-muted-foreground">{empty}</span>
  const [release, revision] = version.split('+')
  return <span title={`${version}${date ? ` · ${date}` : ''}`} className="inline-flex flex-wrap items-baseline gap-1.5 text-xs tabular-nums"><span>{release}</span>{revision && <span className="font-mono text-[10px] text-muted-foreground">{revision.slice(0, 7)}</span>}</span>
}

export function SkillProjectionBrowser({ data, disabled, onChange, mode = 'workspace' }: {
  data: ProjectInjection; disabled: boolean; onChange(): void; mode?: 'workspace' | 'project'
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [operation, setOperation] = useState<{ workspaceId: string; workspaceName: string; request: SkillProjectionRequest } | null>(null)
  const workspace = data.workspaces.find((row) => row.id === workspaceId) ?? data.workspaces[0]
  const skills = data.skills.filter((skill) => skill.name.toLowerCase().includes(search.toLowerCase()))
  const act = (skill: string, action: SkillProjectionRequest['action']) => {
    if (workspace) setOperation({ workspaceId: workspace.id, workspaceName: workspace.name || workspace.id, request: { skill, action } })
  }
  return <div className="@container min-w-0">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      {mode === 'workspace' ? <div className="flex min-w-0 flex-wrap items-center gap-3">
        <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" />} disabled={!data.workspaces.length} aria-label={t('skillManager.chooseWorkspace')}>
          <span className="max-w-52 truncate">{workspace?.name || workspace?.id || t('distribution.empty')}</span><ChevronDown size={14} />
        </DropdownMenuTrigger><DropdownMenuContent>{data.workspaces.map((row) => <DropdownMenuItem key={row.id} onClick={() => { setWorkspaceId(row.id); setExpanded(null) }}>{row.name || row.id}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
        {workspace && <span className="flex items-center gap-2 text-xs text-muted-foreground">{t('skillManager.lastBundle')}<InjectionVersion version={workspace.plan?.fromVersion} empty={t('aliceHarness.unversioned')} /></span>}
      </div> : <p className="max-w-xl text-xs text-muted-foreground">{t('skillManager.prototypeHint')}</p>}
      <label className="flex w-full items-center gap-2 rounded-md border border-input px-2.5 py-2 text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:w-48">
        <Search size={14} aria-hidden="true" /><input aria-label={t('skillManager.search')} placeholder={t('skillManager.search')} value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none" />
      </label>
    </div>
    {mode === 'workspace' && workspace?.error && <p role="alert" className="mb-4 text-sm">{workspace.error}</p>}
    {mode === 'workspace' && workspace?.plan?.blocked && <p className="mb-4 text-xs text-warning">{t('skillManager.blocked')}</p>}
    {mode === 'workspace' && <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.4fr)_1fr_1fr_1.1fr_100px] gap-3 border-b border-border pb-2 text-[11px] text-muted-foreground @min-[560px]:grid"><span>Skill</span><span>{t('skillManager.injectedVersion')}</span><span>{t('skillManager.projectVersion')}</span><span>{t('skillManager.status')}</span><span /></div>}
    {!skills.length && <p role="status" className="py-6 text-sm text-muted-foreground">{t('skillManager.noResults')}</p>}
    {mode === 'workspace' && !workspace && <p className="py-6 text-sm text-muted-foreground">{t('distribution.empty')}</p>}
    <ul>{(mode === 'project' || workspace) && skills.map((skill) => {
      const copy = workspace?.projections?.find((item) => item.name === skill.name)
      const primary = !copy?.installed || !copy.enabled || !copy.canonicalPresent ? 'install' : copy.sourceChanged && copy.files.some((file) => file.differs) ? 'update' : null
      const open = expanded === skill.name
      return <li key={skill.name} className="border-b border-border/65">
        <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-3 ${mode === 'workspace' ? '@min-[560px]:grid-cols-[minmax(0,1.4fr)_1fr_1fr_1.1fr_100px]' : ''}`}>
          <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : skill.name)} className="flex min-w-0 items-center gap-2 rounded py-1 text-left text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronRight size={13} className={`shrink-0 text-muted-foreground transition-transform duration-[var(--motion-fast)] motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} /><span className="truncate">{skill.name}</span></button>
          {mode === 'workspace' ? <>
            <span className="order-3 flex items-center gap-2 @min-[560px]:order-none"><span className="text-[10px] text-muted-foreground @min-[560px]:hidden">{t('skillManager.injectedVersion')}</span><InjectionVersion version={copy?.injectedVersion} date={copy?.injectedAt} empty={copy?.installed ? t('aliceHarness.unversioned') : '—'} /></span>
            <span className="order-4 flex items-center gap-2 @min-[560px]:order-none"><span className="text-[10px] text-muted-foreground @min-[560px]:hidden">Project</span><InjectionVersion version={data.version} empty="—" /></span>
            <span className="order-5 col-span-2 text-xs text-muted-foreground @min-[560px]:order-none @min-[560px]:col-span-1">{copy ? t(`skillManager.${skillProjectionStatus(copy)}`) : t('distribution.error')}{copy?.mirrorDiverged && <span className="ml-1 text-warning">· {t('skillManager.mirrorShort')}</span>}</span>
            <div className="flex items-center justify-end gap-0.5">
              {primary && copy && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => act(skill.name, primary)}>{t(`skillManager.${primary}`)}</Button>}
              {copy?.installed && <DropdownMenu><DropdownMenuTrigger render={<Button size="icon" variant="ghost" />} aria-label={t('skillManager.more', { skill: skill.name })} disabled={disabled}><MoreHorizontal size={15} /></DropdownMenuTrigger><DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setExpanded(open ? null : skill.name)}>{t('skillManager.compare')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => act(skill.name, 'restore')}>{t('skillManager.restore')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => act(skill.name, 'remove')}>{t('skillManager.remove')}</DropdownMenuItem>
              </DropdownMenuContent></DropdownMenu>}
            </div>
          </> : <InjectionVersion version={data.version} empty="—" />}
        </div>
        {open && <div className="border-t border-border/50 pb-4 pt-3">
          {mode === 'workspace' && workspace && copy ? <><p className="mb-3 text-xs text-muted-foreground">{t(copy.enabled ? 'skillManager.retained' : 'skillManager.excluded')}{copy.injectedAt && ` · ${t('skillManager.injectedAt')} ${new Date(copy.injectedAt).toLocaleString()}`}</p><SkillComparison key={`${workspace.id}:${workspace.plan?.planDigest}`} workspaceId={workspace.id} skill={skill.name} /></> : mode === 'workspace' ? <p role="status" className="text-xs text-muted-foreground">{t('distribution.error')}</p> : skill.files.map((file) => <details key={file.path} open={file.path === 'SKILL.md'} className="py-2"><summary className="cursor-pointer font-mono text-xs">{file.path}</summary><pre className="mt-3 max-h-[55vh] overflow-auto whitespace-pre-wrap break-words bg-secondary/25 p-3 text-xs leading-relaxed">{file.content}</pre></details>)}
        </div>}
      </li>
    })}</ul>
    <Dialog open={!!operation} onOpenChange={(open) => { if (!open) setOperation(null) }}><DialogContent className="max-h-[90vh] overflow-auto sm:max-w-4xl" closeLabel={t('common.close')}>
      <DialogTitle>{operation && `${t(`skillManager.${operation.request.action}`)} ${operation.request.skill} · ${operation.workspaceName}`}</DialogTitle>
      <DialogDescription>{t(operation?.request.action === 'restore' ? 'skillManager.restoreHint' : 'skillManager.scopeHint')}</DialogDescription>
      {operation && <WorkspaceTemplateUpgradePanel wsId={operation.workspaceId} layer="alice-harness" projection={operation.request} onWorkspaceChanged={onChange} onClose={() => setOperation(null)} />}
    </DialogContent></Dialog>
  </div>
}

function SkillComparison({ workspaceId, skill }: { workspaceId: string; skill: string }) {
  const { t } = useTranslation()
  const state = useSkillProjection(workspaceId, skill, true)
  if (state.error) return <p role="alert" className="text-xs">{state.error}</p>
  if (!state.data) return <p role="status" className="text-xs">{t('common.loading')}</p>
  return <div>{state.data.files.map((file) => <details key={file.path} className="py-2">
    <summary className="cursor-pointer break-all font-mono text-xs text-muted-foreground">{file.path} · {t(file.unverified ? 'skillManager.unverified' : file.differs ? 'skillManager.different' : 'skillManager.matches')}</summary>
    {file.truncated && <p className="mt-2 text-xs text-warning">{t('skillManager.truncated')}</p>}
    <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">{[{ label: t('skillManager.local'), content: file.currentPreview }, { label: t('skillManager.prototype'), content: file.sourcePreview }].map((side) => <section key={side.label} className="min-w-0"><h5 className="mb-2 text-xs font-medium">{side.label}</h5><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-secondary/30 p-3 text-xs leading-relaxed">{side.content ?? t('skillManager.absent')}</pre></section>)}</div>
  </details>)}</div>
}
