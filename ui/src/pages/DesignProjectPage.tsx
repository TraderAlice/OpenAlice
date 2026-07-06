import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Compass,
  Gauge,
  KeyRound,
  LockKeyhole,
  Monitor,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { designProjects, getDesignProject, type DesignProject, type DesignVariant } from '../design/projects'
import type { ViewSpec } from '../tabs/types'

interface DesignProjectPageProps {
  spec: Extract<ViewSpec, { kind: 'design-project' }>
}

const variantIcons: Record<DesignVariant['layout'], LucideIcon> = {
  'safe-launch': ShieldCheck,
  'mode-ladder': Gauge,
  'goal-picker': Compass,
  'quiet-checklist': ClipboardList,
}

export function DesignProjectPage({ spec }: DesignProjectPageProps) {
  const project = getDesignProject(spec.params.project)

  if (!project) {
    return <UnknownDesignProject slug={spec.params.project} />
  }

  return (
    <div className="min-h-full overflow-y-auto bg-bg">
      <div className="mx-auto flex w-full max-w-[1540px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="border-b border-border pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                Hidden design project
              </div>
              <h1 className="mt-2 text-[28px] font-semibold leading-tight text-text sm:text-[34px]">
                {project.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
                <InfoPill>{project.eyebrow}</InfoPill>
                <InfoPill>{project.status}</InfoPill>
                <InfoPill>Updated {project.updatedAt}</InfoPill>
              </div>
            </div>
            <code className="w-fit max-w-full overflow-x-auto rounded-md border border-border bg-bg-secondary px-3 py-2 font-mono text-[12px] text-text-muted">
              /design/{project.slug}
            </code>
          </div>
        </header>

        <div className="grid min-w-0 gap-6 md:grid-cols-[280px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
          <ProjectBrief project={project} />

          <main className="min-w-0">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-[20px] font-semibold text-text">Versions</h2>
                <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-text-muted">
                  Side-by-side sketches for the same project brief. These are internal drafts, not routes users discover from the app shell.
                </p>
              </div>
              <div className="text-[12px] text-text-muted">
                {project.variants.length} drafts
              </div>
            </div>

            <div className="grid min-w-0 gap-5 2xl:grid-cols-2">
              {project.variants.map((variant) => (
                <VersionPreview key={variant.id} variant={variant} />
              ))}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

function UnknownDesignProject({ slug }: { slug: string }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[620px] rounded-lg border border-border bg-bg-secondary px-5 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-bg-tertiary text-text-muted">
            <Monitor className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold text-text">Design project not found</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-text-muted">
              No project is registered for <code className="font-mono text-text">{slug}</code>. Add it to the design project registry before opening the route.
            </p>
            <div className="mt-4 grid gap-2">
              {designProjects.map((project) => (
                <a
                  key={project.slug}
                  href={`/design/${project.slug}`}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2 text-[13px] text-text-muted transition-colors hover:border-accent/50 hover:text-accent"
                >
                  <span className="min-w-0 truncate">{project.title}</span>
                  <ChevronRight className="h-4 w-4 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProjectBrief({ project }: { project: DesignProject }) {
  return (
    <aside className="min-w-0 rounded-lg border border-border bg-bg-secondary/55 p-4 md:sticky md:top-5 md:self-start">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Context</div>
        <p className="mt-3 text-[13px] leading-relaxed text-text-muted">{project.context.why}</p>
      </div>

      <BriefList title="Goals" icon={CheckCircle2} items={project.context.goals} />
      <BriefList title="Constraints" icon={LockKeyhole} items={project.context.constraints} />
      <BriefList title="Open questions" icon={Compass} items={project.context.openQuestions} />
    </aside>
  )
}

function BriefList({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: string[] }) {
  return (
    <section className="mt-4 border-t border-border pt-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-tertiary text-text-muted">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <h2 className="text-[14px] font-semibold text-text">{title}</h2>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-[12px] leading-relaxed text-text-muted">
            <span className="mt-[7px] h-1 w-1 rounded-full bg-text-muted" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function VersionPreview({ variant }: { variant: DesignVariant }) {
  const Icon = variantIcons[variant.layout]
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-bg-secondary/45">
      <div className="border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-dim text-accent">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-accent">Draft {variant.id}</span>
              <h3 className="text-[16px] font-semibold text-text">{variant.name}</h3>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-text-muted">{variant.summary}</p>
          </div>
        </div>
      </div>

      <div className="bg-bg px-3 py-3 sm:px-4">
        <DesignCanvas variant={variant} />
      </div>

      <div className="grid gap-3 border-t border-border px-4 py-3 md:grid-cols-2">
        <VersionNote label="Intent" text={variant.intent} />
        <VersionNote label="Risk" text={variant.risk} />
      </div>
    </section>
  )
}

function VersionNote({ label, text }: { label: string; text: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-text-muted">{text}</p>
    </div>
  )
}

function DesignCanvas({ variant }: { variant: DesignVariant }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-secondary">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border bg-bg-tertiary/55 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red/70" aria-hidden />
          <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" aria-hidden />
          <span className="h-2.5 w-2.5 rounded-full bg-green/70" aria-hidden />
          <span className="ml-1 truncate font-mono text-[10px] text-text-muted">first-run-guide/{variant.id.toLowerCase()}</span>
        </div>
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-text-muted">Desktop sketch</span>
      </div>
      <div className="min-h-[330px] p-4">
        {variant.layout === 'safe-launch' ? <SafeLaunchMock /> : null}
        {variant.layout === 'mode-ladder' ? <ModeLadderMock /> : null}
        {variant.layout === 'goal-picker' ? <GoalPickerMock /> : null}
        {variant.layout === 'quiet-checklist' ? <QuietChecklistMock /> : null}
      </div>
    </div>
  )
}

function SafeLaunchMock() {
  return (
    <div className="grid h-full min-h-[300px] min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_230px] lg:items-center">
      <div className="min-w-0">
        <div className="inline-flex items-center gap-2 rounded-md border border-green/30 bg-green/10 px-2.5 py-1 text-[11px] font-semibold text-green">
          <ShieldCheck className="h-3.5 w-3.5" />
          Safe start
        </div>
        <h4 className="mt-5 max-w-[520px] text-[34px] font-semibold leading-[1.05] text-text">
          Start in Lite. Add brokers when you need them.
        </h4>
        <p className="mt-4 max-w-[560px] text-[14px] leading-relaxed text-text-muted">
          Alice can research, explain, and help you build workspaces before any trading system is connected.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <MockButton primary>Ask Alice</MockButton>
          <MockButton>Continue setup</MockButton>
        </div>
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-bg px-3 py-3">
        <MockStatusRow icon={Bot} label="Alice" value="Ready" state="ok" />
        <MockStatusRow icon={WalletCards} label="UTA" value="Off" />
        <MockStatusRow icon={LockKeyhole} label="Broker writes" value="Blocked" state="ok" />
      </div>
    </div>
  )
}

function ModeLadderMock() {
  const modes = [
    { name: 'Lite', text: 'Research only', active: true },
    { name: 'Readonly', text: 'Read accounts', active: false },
    { name: 'Pro', text: 'Approve writes', active: false },
  ]
  return (
    <div className="flex min-h-[300px] min-w-0 flex-col justify-center gap-5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Choose the level of access</div>
        <h4 className="mt-2 text-[28px] font-semibold leading-tight text-text">OpenAlice starts with brokers disconnected.</h4>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {modes.map((mode) => (
          <div
            key={mode.name}
            className={`min-w-0 rounded-lg border px-3 py-3 ${
              mode.active
                ? 'border-accent bg-accent-dim text-text'
                : 'border-border bg-bg text-text-muted'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-semibold">{mode.name}</span>
              {mode.active ? <CheckCircle2 className="h-4 w-4 text-accent" /> : null}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed">{mode.text}</p>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-bg px-3 py-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-text">Next useful step</div>
          <p className="mt-1 text-[12px] text-text-muted">Connect an AI provider, then decide whether UTA should stay off.</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-accent" />
      </div>
    </div>
  )
}

function GoalPickerMock() {
  const goals = [
    { icon: Sparkles, title: 'Research', body: 'Ask Alice to read, compare, and explain.', badge: 'Lite' },
    { icon: WalletCards, title: 'Portfolio', body: 'Bring positions into analysis safely.', badge: 'Readonly' },
    { icon: TerminalSquare, title: 'Trading', body: 'Use approvals before broker writes.', badge: 'Pro' },
  ]
  return (
    <div className="flex min-h-[300px] min-w-0 flex-col justify-center gap-5">
      <div className="max-w-[620px]">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">What do you want first?</div>
        <h4 className="mt-2 text-[30px] font-semibold leading-tight text-text">Pick a starting point. Alice will only ask for what that path needs.</h4>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {goals.map((goal, index) => {
          const Icon = goal.icon
          return (
            <div
              key={goal.title}
              className={`min-w-0 rounded-lg border px-3 py-3 ${
                index === 0 ? 'border-accent bg-accent-dim' : 'border-border bg-bg'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <Icon className={index === 0 ? 'h-4 w-4 text-accent' : 'h-4 w-4 text-text-muted'} />
                <span className="rounded-md border border-border bg-bg-secondary px-2 py-0.5 text-[10px] font-semibold text-text-muted">
                  {goal.badge}
                </span>
              </div>
              <div className="mt-4 text-[15px] font-semibold text-text">{goal.title}</div>
              <p className="mt-2 text-[12px] leading-relaxed text-text-muted">{goal.body}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function QuietChecklistMock() {
  const tasks = [
    { icon: ShieldCheck, title: 'Mode', body: 'Lite by default', done: true },
    { icon: KeyRound, title: 'AI access', body: 'Add one provider key', done: false },
    { icon: Bot, title: 'Agent runtime', body: 'Use bundled Pi or another CLI', done: false },
  ]
  return (
    <div className="grid min-h-[300px] min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Welcome</div>
        <h4 className="mt-2 text-[30px] font-semibold leading-tight text-text">Alice is open. Finish setup at your own pace.</h4>
        <p className="mt-4 max-w-[560px] text-[13px] leading-relaxed text-text-muted">
          The opening guide stays short, then hands durable tasks to the setup checklist.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <MockButton primary>Start in Lite</MockButton>
          <MockButton>Open checklist</MockButton>
        </div>
      </div>
      <div className="min-w-0 rounded-lg border border-border bg-bg px-3 py-3">
        {tasks.map((task) => {
          const Icon = task.icon
          return (
            <div key={task.title} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 border-b border-border py-3 last:border-b-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-tertiary text-text-muted">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-text">{task.title}</div>
                <div className="mt-0.5 text-[12px] text-text-muted">{task.body}</div>
              </div>
              <CheckCircle2 className={`mt-1 h-4 w-4 ${task.done ? 'text-green' : 'text-text-muted'}`} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MockStatusRow({ icon: Icon, label, value, state }: { icon: LucideIcon; label: string; value: string; state?: 'ok' }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3 last:border-b-0">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-bg-tertiary text-text-muted">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 text-[13px] font-semibold text-text">{label}</div>
      <div className={state === 'ok' ? 'text-[12px] font-semibold text-green' : 'text-[12px] font-semibold text-text-muted'}>
        {value}
      </div>
    </div>
  )
}

function MockButton({ children, primary = false }: { children: string; primary?: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3.5 py-2 text-[13px] font-semibold ${
        primary
          ? 'bg-accent text-white'
          : 'border border-border bg-bg text-text-muted'
      }`}
    >
      {children}
      {primary ? <ArrowRight className="h-4 w-4" /> : null}
    </button>
  )
}

function InfoPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-6 items-center rounded-md border border-border bg-bg-secondary px-2 text-[11px] font-medium text-text-muted">
      {children}
    </span>
  )
}
