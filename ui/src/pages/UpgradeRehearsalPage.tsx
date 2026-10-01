import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { displayVersion } from '../components/dev/upgrade-rehearsal/releases'
import { ReleasePublisher } from '../components/dev/upgrade-rehearsal/ReleasePublisher'
import { identityLabel, type ReleaseChannel } from '@traderalice/update-lifecycle'
import {
  ArrowRight,
  Check,
  FlaskConical,
  Monitor,
  Package,
  RotateCcw,
  Server,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleDetailsTrigger,
} from '../components/ui/collapsible'
import { useUpgradeRehearsal } from '../hooks/useUpgradeRehearsal'
import {
  blocker,
  contentTarget,
  isChatCase,
  scenarioExplanation,
  consumed,
  group,
  plan,
  releaseSnapshot,
  scenarios,
  runtimeTargetVersion,
  type Scenario,
  type Step,
} from '../components/dev/upgrade-rehearsal/model'

const stageNames: Record<Step, string> = {
  'client-download': 'Download client',
  'client-install': 'Install client',
  'client-activate': 'Restart client',
  'client-verify': 'Verify client',
  'backend-download': 'Download backend',
  'backend-install': 'Install backend',
  'backend-activate': 'Restart backend',
  'backend-verify': 'Verify backend',
  'backend-reconnect': 'Reconnect',
  'content-check': 'Check workspace readiness',
  'content-apply': 'Apply workspace update',
  'content-verify': 'Verify workspace',
}
const panel = 'rounded-2xl border border-border bg-card'
function Disclosure({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <Collapsible className="border-t border-border px-5 py-2">
      <CollapsibleDetailsTrigger>{title}</CollapsibleDetailsTrigger>
      <CollapsibleContent>
        <div className="pt-3 pb-3 text-sm text-muted-foreground">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
export function UpgradeRehearsalPage() {
  const {
    state: s,
    dispatch,
    discovery,
    checkForUpdates,
  } = useUpgradeRehearsal()
  const editing = s.phase === 'scenario'
  const reviewing = s.phase === 'review'
  const steps = editing || reviewing ? plan(s) : s.steps
  const reason = blocker(s)
  const stage = editing ? 0 : reviewing ? 1 : 2
  const assets = releaseSnapshot.assets.reduce<
    Record<string, typeof releaseSnapshot.assets>
  >((groups, asset) => {
    ;(groups[group(asset.name)] ??= []).push(asset)
    return groups
  }, {})
  const message =
    s.phase === 'suspended'
      ? 'App restart checkpoint. Resume to verify the new version and continue.'
      : s.phase === 'failed'
        ? s.log.at(-1) ?? 'Verification failed. Completed installation is retained.'
        : s.phase === 'blocked'
          ? 'The workspace is busy. Release it before applying content changes.'
          : s.phase === 'done'
            ? 'Rehearsal complete. Review the resulting versions above.'
            : s.phase === 'running'
              ? `Next: ${stageNames[steps[s.cursor]] ?? 'Finish'}`
              : reviewing
                ? 'Review the order and approve this exact plan.'
                : 'Choose a scenario. No real app, backend, or workspace will be changed.'
  const action =
    s.phase === 'scenario'
      ? 'review'
      : s.phase === 'review'
        ? 'approve'
        : s.phase === 'suspended'
          ? 'resume'
          : s.phase === 'failed'
            ? 'retry'
            : s.phase === 'blocked'
              ? 'release'
              : 'next'
  const label = {
    review: 'Review plan',
    approve: 'Approve & rehearse',
    resume: 'Resume after restart',
    retry: 'Retry current stage',
    release: 'Simulate workspace becoming idle',
    next: 'Run next stage',
  }[action]
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Upgrade rehearsal
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Understand the plan before changing the updater.
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
          <FlaskConical size={14} /> Simulation only
        </span>
      </div>
      <ReleasePublisher publication={s.publication} dispatch={dispatch} />
      <h3 className="font-semibold">2. Consume updates</h3>
      <ol
        aria-label="Rehearsal progress"
        className="flex items-center gap-3 border-y border-border py-4 text-sm"
      >
        {['Scenario', 'Review plan', 'Rehearse'].map((v, i) => (
          <li
            key={v}
            aria-current={stage === i ? 'step' : undefined}
            className={`flex items-center gap-2 ${stage === i ? 'text-primary font-medium' : 'text-muted-foreground'}`}
          >
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full ${stage === i ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
            >
              {stage > i ? <Check size={14} /> : i + 1}
            </span>
            {v}
            {i < 2 && <ArrowRight size={14} className="ml-2 hidden sm:block" />}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-end gap-4">
        <label className="min-w-0 flex-1 text-xs text-muted-foreground">
          Scenario
          <Select
            aria-label="Scenario"
            disabled={!editing}
            value={s.scenario}
            onValueChange={(selectedValue) =>
              dispatch({ type: 'scenario', value: selectedValue as Scenario })
            }
            className="mt-2"
            options={Object.entries(scenarios).map(([k, v]) => ({ value: k, label: v }))}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Follow channel
          <Select
            aria-label="Follow channel"
            disabled={!editing}
            value={s.channel}
            onValueChange={(selectedValue) =>
              dispatch({
                type: 'channel',
                value: selectedValue as ReleaseChannel,
              })
            }
            className="mt-2 w-auto"
            options={[
              { value: 'stable', label: 'Stable' },
              { value: 'beta', label: 'Beta' },
              { value: 'dev', label: 'Dev commit' },
            ]}
          />
        </label>
        <Button
          variant="outline"
          disabled={!editing || discovery.checking}
          onClick={() => void checkForUpdates()}
        >
          Check for updates
        </Button>
        <Button variant="ghost" onClick={() => dispatch({ type: 'reset' })}>
          <RotateCcw size={15} /> Reset
        </Button>
      </div>
      <p aria-live="polite" className="break-all text-sm text-muted-foreground">
        {discovery.checking
          ? 'Checking channel…'
          : (discovery.error ??
            (discovery.value
              ? `Channel head: ${displayVersion(identityLabel(discovery.value))} · Candidate: ${displayVersion(s.target)}`
              : 'This channel has no active release. Build and activate one above.'))}{' '}
        {s.phase !== 'scenario' &&
          'This plan is frozen; later publications do not change it.'}
      </p>
      <p className="rounded-lg bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        {scenarioExplanation(s)} Switching scenarios loads a fresh fixture.
      </p>
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <section className={`${panel} min-w-0 overflow-hidden`}>
          <div className="p-5 border-b border-border">
            <h3 className="font-semibold">
              {stage === 2 ? 'Current environment' : 'What will change'}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {s.scenario === 'integrated'
                ? 'Integrated Electron · local app and backend move together'
                : s.channel === 'dev'
                  ? 'Separated mode · macOS ARM64 CLI relay + web → Linux x64 backend'
                  : 'Separated mode · macOS ARM64 app → Linux x64 backend'}
            </p>
          </div>
          {[
            {
              name: s.channel === 'dev' ? 'CLI relay + web' : 'This app',
              icon: Monitor,
              active: s.client,
              installed: s.clientInstalled,
              target: steps.includes('client-activate') ? runtimeTargetVersion(s, 'client') : s.client,
            },
            {
              name:
                s.scenario === 'integrated'
                  ? 'Local backend'
                  : 'Remote backend',
              icon: Server,
              active: s.server,
              installed: s.serverInstalled,
              target:
                steps.includes('backend-activate') ? runtimeTargetVersion(s, 'backend')
                  : s.scenario === 'integrated' && steps.includes('client-activate') ? runtimeTargetVersion(s, 'client') : s.server,
            },
            {
              name: isChatCase(s) ? 'Chat Workspace' : 'Workspace content',
              icon: Package,
              active: s.workspace,
              installed: s.workspace,
              target: s.content ? contentTarget(s) : s.workspace,
            },
          ].map(({ name, icon: Icon, active, installed, target }) => (
            <div
              key={name}
              className="flex flex-wrap items-center gap-3 border-b border-border p-5"
            >
              <span className="rounded-xl bg-muted p-3">
                <Icon size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-medium">{name}</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Active {displayVersion(active)}
                  {installed !== active &&
                    ` · Installed ${displayVersion(installed)}`}
                  {name === 'Remote backend' &&
                    !s.connected &&
                    ' · Reconnecting'}
                </p>
              </div>
              <span className="min-w-0 max-w-full break-all text-sm font-mono">
                {active === target
                  ? displayVersion(active)
                  : `${displayVersion(active)} → ${displayVersion(target)}`}
              </span>
            </div>
          ))}
          <div className="p-5 space-y-3 text-sm">
            {s.scenario !== 'integrated' && (
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={s.backend}
                  disabled={!editing}
                  onChange={(e) =>
                    dispatch({ type: 'backend', value: e.target.checked })
                  }
                />{' '}
                Include connected backend
              </label>
            )}
            <label className="flex items-center gap-2">
              <Checkbox
                checked={s.content}
                disabled={!editing}
                onChange={(e) =>
                  dispatch({ type: 'content', value: e.target.checked })
                }
              />{' '}
              {isChatCase(s)
                ? 'Include managed Chat template update'
                : 'Include workspace content'}
            </label>
          </div>
          <Disclosure title="Artifacts consumed by this plan">
            <p className="mb-3">
              Simulated target {s.target}; immutable artifacts are frozen with
              the approved plan. No downloads occur.
            </p>
            {consumed(s).map((n) => (
              <code key={n} className="block break-all py-1 text-xs">
                {n}
              </code>
            ))}
          </Disclosure>
        </section>
        <section className={`${panel} p-5`}>
          <h3 className="font-semibold">Execution order</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            One stage at a time. Approved choices stay frozen.
          </p>
          <ol className="mt-5 space-y-3">
            {steps.map((step, i) => (
              <li
                key={step}
                className={`flex items-center gap-3 text-sm ${stage === 2 && i === s.cursor ? 'font-medium text-primary' : 'text-muted-foreground'}`}
              >
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${i < s.cursor ? 'bg-primary/10 text-primary' : 'bg-muted'}`}
                >
                  {i < s.cursor ? <Check size={14} /> : i + 1}
                </span>
                {stageNames[step]}
              </li>
            ))}
          </ol>
          {!steps.length && (
            <p className="mt-5 text-sm text-muted-foreground">
              Nothing needs updating.
            </p>
          )}
        </section>
      </div>
      <div
        className={`${panel} sticky bottom-3 z-10 bg-background shadow-sm p-5 flex flex-wrap items-center justify-between gap-4`}
      >
        <div className="min-w-0 flex-1 text-sm" aria-live="polite">
          <p
            className={
              (reason && stage < 2) || s.phase === 'failed'
                ? 'text-destructive'
                : ''
            }
          >
            {reason && stage < 2 ? reason : message}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {stage === 2
              ? `${s.cursor} / ${s.steps.length} stages completed · reload preserves this rehearsal`
              : 'Only this browser tab’s simulation is affected.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {reviewing && (
            <Button
              variant="outline"
              onClick={() => dispatch({ type: 'back' })}
            >
              Back
            </Button>
          )}
          {s.phase !== 'done' ? (
            <Button
              disabled={reviewing && !!reason}
              onClick={() => dispatch({ type: action })}
            >
              {label}
              <ArrowRight size={16} />
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => dispatch({ type: 'continue' })}
            >
              Plan next update
            </Button>
          )}
        </div>
      </div>
      <section className={`${panel} overflow-hidden`}>
        <Disclosure
          title={`Release mirror · ${releaseSnapshot.tag} · ${releaseSnapshot.assets.length} attachments`}
        >
          <p className="mb-4">
            Recorded release inventory, not a live availability check. Simulated
            releases reuse this topology; these are not live release listings.{' '}
            <a
              href={releaseSnapshot.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              Source release
            </a>
          </p>
          {Object.entries(assets).map(([name, items]) => (
            <div key={name} className="mb-4">
              <h4 className="font-medium text-foreground mb-2">
                {name} · {items?.length}
              </h4>
              {items?.map((a) => (
                <div key={a.name} className="flex gap-3 py-1 text-xs">
                  <code className="min-w-0 flex-1 break-all">{a.name}</code>
                  <span className="shrink-0">
                    {(a.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                </div>
              ))}
            </div>
          ))}
        </Disclosure>
        <Disclosure title={`Event log · ${s.log.length}`}>
          <ol className="space-y-2 font-mono text-xs">
            {s.log.map((v, i) => (
              <li key={i}>
                {i + 1}. {v}
              </li>
            ))}
          </ol>
          {!s.log.length && 'Approve a plan to begin.'}
        </Disclosure>
        <Disclosure title="Rehearsal assumptions & fault scenarios">
          <p className="flex gap-2">
            <ShieldCheck size={18} className="shrink-0" />
            Backend ≤ app; content R2 requires backend ≥ 0.94.2. These are
            proposed rules, not verified production compatibility guarantees.
          </p>
          <p className="mt-3">
            Choose Reconnect failure or Workspace busy to exercise recovery. No
            real SSH, updater, signing, or installation APIs are called.
          </p>
          <p className="mt-3">
            Stable and beta model desktop + CLI artifacts; dev models immutable
            CLI commit builds. Platform selection, broker pack activation and
            unknown write outcomes remain outside this rehearsal. Discovery
            state is shared with the real update provider; installation steps
            remain simulated.
          </p>
        </Disclosure>
      </section>
    </div>
  )
}
