import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Copy,
  FileText,
  Search,
  Terminal,
  Check,
} from 'lucide-react'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { FileContentView } from '../FileContentView'
import { CenteredLoading } from '../StateViews'
import {
  cliExports,
  type CapabilityOwner,
  useWorkspaceCapabilities,
  useWorkspaceCli,
} from '../../hooks/useWorkspaceCapabilities'
import { useWorkbenchFile } from '../../hooks/useWorkbenchFile'
import {
  listFiles,
  stripFrontmatter,
  type ReadFileResult,
} from '../workspace/api'
import { AliceHarnessPanel } from './AliceHarnessPanel'
import { MirrorDetails } from './MirrorDetails'
import './capabilities.css'

function SearchBox({
  value,
  onChange,
}: {
  value: string
  onChange(value: string): void
}) {
  const { t } = useTranslation()
  return (
    <label className="cap-search">
      <Search size={15} aria-hidden />
      <input
        type="search"
        aria-label={t('capabilities.search')}
        placeholder={t('capabilities.search')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t('capabilities.copy')}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true)
              setFailed(false)
            },
            () => setFailed(true),
          )
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </Button>
      {failed && <span role="alert">{t('capabilities.copyFailed')}</span>}
    </>
  )
}
function Document({
  path,
  result,
  resolveHref,
}: {
  path: string
  result: ReadFileResult
  resolveHref(href: string): string
}) {
  const { t } = useTranslation()
  const [raw, setRaw] = useState(false)
  return (
    <>
      <div className="cap-document-toolbar">
        <span className="cap-path">{path}</span>
        <Tabs
          value={raw ? 'source' : 'read'}
          onValueChange={(v) => setRaw(v === 'source')}
        >
          <TabsList aria-label={t('capabilities.view')}>
            <TabsTrigger value="read">{t('capabilities.read')}</TabsTrigger>
            <TabsTrigger value="source">{t('capabilities.source')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {raw && result.kind === 'ok' ? (
        <pre className="cap-source">{result.content}</pre>
      ) : (
        <FileContentView
          path={path}
          result={
            result.kind === 'ok'
              ? { ...result, content: stripFrontmatter(result.content) }
              : result
          }
          resolveRelativeHref={resolveHref}
        />
      )}
    </>
  )
}
function Attachment({
  wsId,
  path,
  resolveHref,
}: {
  wsId: string
  path: string
  resolveHref(href: string): string
}) {
  const result = useWorkbenchFile(wsId, path)
  return result ? (
    <Document
      key={path}
      path={path}
      result={result}
      resolveHref={resolveHref}
    />
  ) : (
    <CenteredLoading />
  )
}
function SkillFiles({
  wsId,
  directory,
  onSelect,
}: {
  wsId: string
  directory: string
  onSelect(path: string): void
}) {
  const { t } = useTranslation()
  const [path, setPath] = useState(directory)
  const [files, setFiles] = useState<Awaited<ReturnType<typeof listFiles>>>()
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setFiles(undefined)
    setError('')
    void listFiles(wsId, path).then(
      (v) => {
        if (alive) setFiles(v)
      },
      (e) => {
        if (alive) setError(String(e))
      },
    )
    return () => {
      alive = false
    }
  }, [wsId, path])
  return (
    <details className="cap-files">
      <summary>{t('capabilities.files')}</summary>
      {error && <p role="alert">{error}</p>}
      <div className="cap-path">{path}</div>
      {path !== directory && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPath(path.slice(0, path.lastIndexOf('/')))}
        >
          <ArrowLeft size={14} />
          {t('capabilities.back')}
        </Button>
      )}
      {files?.entries.map((f) => (
        <Button
          key={f.name}
          variant="ghost"
          size="sm"
          onClick={() =>
            f.kind === 'dir'
              ? setPath(`${path}/${f.name}`)
              : onSelect(`${path}/${f.name}`)
          }
        >
          <FileText size={13} />
          {f.name}
          {f.kind === 'dir' && <ChevronRight size={13} />}
        </Button>
      ))}
    </details>
  )
}

const capabilityOwners: CapabilityOwner[] = ['alice-harness', 'workspace', 'unknown']
const ownerKeys = {
  'alice-harness': 'ownerAlice',
  workspace: 'ownerWorkspace',
  unknown: 'ownerUnknown',
} as const

export function CapabilityBrowser({
  wsId,
  view,
  resolvePath,
}: {
  wsId: string
  view: 'skills' | 'instructions' | 'injection'
  resolvePath(path: string): string
}) {
  const { t } = useTranslation()
  const [attempt, setAttempt] = useState(0)
  const state = useWorkspaceCapabilities(wsId, attempt)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string>()
  const [mobileDetail, setMobileDetail] = useState(false)
  const [attachmentChoice, setAttachment] = useState<{
    owner: string
    path: string
  }>()
  const data = state?.data
  const items = useMemo(
    () =>
      !data ? [] : view === 'instructions' ? data.instructions : data.skills,
    [data, view],
  )
  const filtered = [...items]
    .sort((a, b) => capabilityOwners.indexOf(a.owner ?? 'unknown') - capabilityOwners.indexOf(b.owner ?? 'unknown'))
    .filter((i) =>
      `${i.name} ${i.path} ${i.content.kind === 'ok' ? i.content.content : ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
  const current = filtered.find((i) => i.path === selected) ?? filtered[0]
  const attachment =
    attachmentChoice?.owner === current?.path
      ? attachmentChoice?.path
      : undefined
  if (!state) return <CenteredLoading label={t('common.loading')} />
  if (!data)
    return (
      <div role="alert">
        <p>{state.error}</p>
        <Button onClick={() => setAttempt((v) => v + 1)}>
          {t('common.retry')}
        </Button>
      </div>
    )
  const resolveHref = (href: string) => {
    const path = new URL(
      href,
      `https://workspace.invalid/${attachment ?? current?.path ?? ''}`,
    ).pathname.slice(1)
    try {
      return resolvePath(decodeURIComponent(path))
    } catch {
      return resolvePath(path)
    }
  }
  if (view === 'injection')
    return (
      <div className="cap-injection">
        <div>
          <span className="cap-eyebrow">01 · WORKSPACE</span>
          <h2>{t('capabilities.disk')}</h2>
          <p>{t('capabilities.diskHint')}</p>
          <div className="cap-root-list">
            {data.roots.map((root) => (
              <code key={root}>{root}</code>
            ))}
          </div>
          <p>{t('capabilities.discoveryHint')}</p>
        </div>
        <div>
          <span className="cap-eyebrow">02 · SESSION</span>
          <h2>{t('capabilities.runtime')}</h2>
          <p>{t('capabilities.runtimeHint')}</p>
          <code>PATH · AQ_WS_ID · OPENALICE_TOOL_URL / SOCKET</code>
          <p>{t('capabilities.secretsHint')}</p>
        </div>
        <div>
          <span className="cap-eyebrow">03 · LIFECYCLE</span>
          <h2>{t('capabilities.upgrades')}</h2>
          <p>{t('capabilities.ownerAliceHint')}</p>
          <p>{t('capabilities.ownerWorkspaceHint')}</p>
        </div>
        {data.errors.map((e) => (
          <p key={e} role="alert">
            {e}
          </p>
        ))}
      </div>
    )
  return (
    <>
      <div className="cap-section-intro">
        <div>
          <h2>
            {t(`capabilities.${view}`)} <span>{items.length}</span>
          </h2>
          <p>
            {t(
              view === 'skills'
                ? 'capabilities.skillsHint'
                : 'capabilities.instructionsHint',
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAttempt((v) => v + 1)}
        >
          {t('harnessSurface.refresh')}
        </Button>
      </div>
      {data.errors.map((e) => (
        <p role="alert" key={e}>
          {e}
        </p>
      ))}
      <div className={`cap-browser ${mobileDetail ? 'is-detail' : ''}`}>
        <aside className="cap-directory">
          <SearchBox value={query} onChange={setQuery} />
          <nav aria-label={t(`capabilities.${view}`)}>
            {capabilityOwners.map((owner) => {
              const owned = filtered.filter((item) => (item.owner ?? 'unknown') === owner)
              if (!owned.length) return null
              return (
                <section className="cap-origin-group" key={owner} aria-label={t(`capabilities.${ownerKeys[owner]}`)}>
                  <h3>{t(`capabilities.${ownerKeys[owner]}`)} <span>{owned.length}</span></h3>
                  {owned.map((i) => (
                    <button
                      className="cap-row"
                      aria-current={current?.path === i.path ? 'page' : undefined}
                      key={i.path}
                      onClick={() => {
                        setSelected(i.path)
                        setAttachment(undefined)
                        setMobileDetail(true)
                      }}
                    >
                      <BookOpen size={15} aria-hidden />
                      <span>
                        <strong>{i.name}</strong>
                        <small>{t(`mirrors.${i.source ?? 'canonical'}`)}</small>
                      </span>
                      <ChevronRight size={13} aria-hidden />
                    </button>
                  ))}
                </section>
              )
            })}
          </nav>
          {!filtered.length && (
            <p className="cap-empty">{t('capabilities.empty')}</p>
          )}
        </aside>
        <article className="cap-reader">
          <Button
            className="cap-mobile-back"
            variant="ghost"
            size="sm"
            onClick={() => setMobileDetail(false)}
          >
            <ArrowLeft size={14} />
            {t('capabilities.back')}
          </Button>
          {current ? (
            <>
              <div className="cap-reader-heading">
                <span className="cap-eyebrow">
                  {t(`capabilities.${ownerKeys[current.owner ?? 'unknown']}`)}
                </span>
                <h2>{current.name}</h2>
                <p>{t(`capabilities.${ownerKeys[current.owner ?? 'unknown']}Hint`)}</p>
                {current.description && <p>{current.description}</p>}
                <code className="cap-path">{current.path}</code>
              </div>
              <MirrorDetails
                key={`mirrors:${current.path}`}
                wsId={wsId}
                skill={current}
                instructions={view === 'instructions'}
              />
              {view === 'skills' && (
                <SkillFiles
                  key={`files:${current.path}`}
                  wsId={wsId}
                  directory={current.path.slice(
                    0,
                    current.path.lastIndexOf('/'),
                  )}
                  onSelect={(path) =>
                    setAttachment({ owner: current.path, path })
                  }
                />
              )}
              {attachment ? (
                <Attachment
                  key={`attachment:${attachment}`}
                  wsId={wsId}
                  path={attachment}
                  resolveHref={resolveHref}
                />
              ) : (
                <Document
                  key={`document:${current.path}`}
                  path={current.path}
                  result={current.content}
                  resolveHref={resolveHref}
                />
              )}
            </>
          ) : (
            <p className="cap-empty">{t('capabilities.empty')}</p>
          )}
        </article>
      </div>
    </>
  )
}

export function CliBrowser({ wsId }: { wsId: string }) {
  const { t } = useTranslation()
  const [exportKey, setExport] = useState('data')
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [mobileDetail, setMobileDetail] = useState(false)
  const state = useWorkspaceCli(wsId, exportKey, attempt)
  const manifest = state?.data
  const binary = cliExports.find((e) => e.key === exportKey)!.name
  const commands = Object.entries(manifest?.groups ?? {}).flatMap(
    ([group, verbs]) =>
      Object.entries(verbs).map(([verb, command]) => ({
        ...command,
        group,
        verb,
        name: `${binary} ${group} ${verb}`,
      })),
  )
  const filtered = commands.filter((c) =>
    `${c.name} ${c.description}`.toLowerCase().includes(query.toLowerCase()),
  )
  const current = filtered.find((c) => c.name === selected) ?? filtered[0]
  return (
    <>
      <AliceHarnessPanel wsId={wsId} onChange={() => setAttempt((value) => value + 1)} />
      <div className="cap-section-intro">
        <div>
          <h2>{t('capabilities.cli')}</h2>
          <p>{t('capabilities.cliOwnerHint')}</p>
        </div>
        <span className="cap-live">{t('capabilities.live')}</span>
      </div>
      <Tabs
        value={exportKey}
        onValueChange={(v) => {
          setExport(String(v))
          setSelected('')
          setMobileDetail(false)
        }}
      >
        <TabsList className="cap-cli-tabs" aria-label={t('capabilities.cli')}>
          {cliExports.map((e) => (
            <TabsTrigger key={e.key} value={e.key}>
              <Terminal size={14} />
              {e.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {!state ? (
        <CenteredLoading />
      ) : state.error ? (
        <div role="alert">
          <p>{state.error}</p>
          <Button onClick={() => setAttempt((v) => v + 1)}>
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <div className={`cap-browser ${mobileDetail ? 'is-detail' : ''}`}>
          <aside className="cap-directory">
            <SearchBox value={query} onChange={setQuery} />
            <nav aria-label={t('capabilities.commands')}>
              {Object.keys(manifest?.groups ?? {}).map((group) => {
                const items = filtered.filter((c) => c.group === group)
                if (!items.length) return null
                const key = `${exportKey}:${group}`
                const open = Boolean(query.trim()) || !collapsed[key]
                return (
                  <Collapsible
                    key={key}
                    className="cap-cli-group"
                    open={open}
                    onOpenChange={(value) => setCollapsed((previous) => ({ ...previous, [key]: !value }))}
                  >
                    <h3>
                      <CollapsibleTrigger className="cap-cli-group-trigger" title={manifest?.groupDescriptions?.[group]}>
                        <ChevronRight size={13} aria-hidden className={open ? 'is-open' : ''} />
                        <span>{group}</span>
                        <small aria-hidden>{items.length}</small>
                      </CollapsibleTrigger>
                    </h3>
                    <CollapsibleContent inert={!open} aria-hidden={!open || undefined}>
                      {items.map((c) => (
                        <button
                          className="cap-row cap-cli-row"
                          key={c.name}
                          aria-current={current?.name === c.name ? 'page' : undefined}
                          onClick={() => {
                            setSelected(c.name)
                            setMobileDetail(true)
                          }}
                        >
                          <span><strong>{c.verb}</strong></span>
                        </button>
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </nav>
            {!filtered.length && (
              <p className="cap-empty">{t('capabilities.empty')}</p>
            )}
          </aside>
          <article className="cap-reader">
            <Button
              className="cap-mobile-back"
              variant="ghost"
              size="sm"
              onClick={() => setMobileDetail(false)}
            >
              <ArrowLeft size={14} />
              {t('capabilities.back')}
            </Button>
            {current ? (
              <>
                <div className="cap-reader-heading">
                  <span className="cap-eyebrow">
                    {current.group} · {t('capabilities.command')}
                  </span>
                  <h2>{current.verb}</h2>
                  <p>{current.description}</p>
                </div>
                <div className="cap-command">
                  <code>
                    {current.name}
                    {(current.schema.required ?? [])
                      .map((name) => ` --${name} <${name}>`)
                      .join('')}
                  </code>
                  <CopyButton
                    key={current.name}
                    text={
                      current.name +
                      (current.schema.required ?? [])
                        .map((name) => ` --${name} <${name}>`)
                        .join('')
                    }
                  />
                </div>
                <p className="cap-note">{t('capabilities.noExecute')}</p>
                <h3 className="cap-subtitle">{t('capabilities.parameters')}</h3>
                {Object.keys(current.schema.properties ?? {}).length ? (
                  <div className="cap-parameters">
                    {Object.entries(current.schema.properties ?? {}).map(
                      ([name, p]) => (
                        <div key={name}>
                          <div>
                            <code>--{name}</code>
                            <span>{p.type ?? 'JSON'}</span>
                            {current.schema.required?.includes(name) && (
                              <b>{t('capabilities.required')}</b>
                            )}
                          </div>
                          <p>{p.description}</p>
                          {p.enum && (
                            <code>{p.enum.map(String).join(' · ')}</code>
                          )}
                          {p.default !== undefined && (
                            <p>
                              {t('capabilities.default')}:{' '}
                              <code>{JSON.stringify(p.default)}</code>
                            </p>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <p className="cap-note">{t('capabilities.noParameters')}</p>
                )}
                <details className="cap-files">
                  <summary>{t('capabilities.schema')}</summary>
                  <pre className="cap-source">
                    {JSON.stringify(current.schema, null, 2)}
                  </pre>
                </details>
              </>
            ) : (
              <p className="cap-empty">{t('capabilities.empty')}</p>
            )}
          </article>
        </div>
      )}
    </>
  )
}
