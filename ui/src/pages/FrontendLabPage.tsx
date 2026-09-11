import { useState } from 'react'
import { CheckCircle2, CircleAlert, Inbox, LoaderCircle, Newspaper } from 'lucide-react'

import { agentRuntimeLogApi } from '../api/agentRuntimeLog'
import { Button } from '../components/ui/button'
import { GLOBAL_ACTIVITY_REFRESH_EVENT } from '../hooks/useGlobalAgentActivity'

type TestState = 'running' | 'success' | 'error'
type ProductTestFamily = 'inbox' | 'news'

const TESTS: ReadonlyArray<{
  state: TestState
  label: string
  description: string
  icon: typeof LoaderCircle
  variant: 'outline' | 'default' | 'destructive'
}> = [
  {
    state: 'running',
    label: 'Show running',
    description: 'Persistent work in progress; it expires automatically after the test window.',
    icon: LoaderCircle,
    variant: 'outline',
  },
  {
    state: 'success',
    label: 'Show success',
    description: 'A completed significant activity using the normal success duration.',
    icon: CheckCircle2,
    variant: 'default',
  },
  {
    state: 'error',
    label: 'Show error',
    description: 'A failed significant activity that remains visible longer.',
    icon: CircleAlert,
    variant: 'destructive',
  },
]

export function FrontendLabPage() {
  const [pending, setPending] = useState<TestState | ProductTestFamily | null>(null)
  const [error, setError] = useState<string | null>(null)

  const trigger = async (state: TestState) => {
    setPending(state)
    setError(null)
    try {
      await agentRuntimeLogApi.triggerSonnerTest(state)
      window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(null)
    }
  }

  const triggerProductActivity = async (family: ProductTestFamily) => {
    setPending(family)
    setError(null)
    try {
      await agentRuntimeLogApi.triggerProductActivityTest(family)
      window.dispatchEvent(new Event(GLOBAL_ACTIVITY_REFRESH_EVENT))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="px-4 py-5 md:px-6">
      <div className="max-w-[760px] space-y-5">
        <div>
          <h2 className="text-[18px] font-semibold text-foreground">Frontend lab</h2>
          <p className="mt-1 max-w-[620px] text-[13px] leading-relaxed text-muted-foreground">
            Exercise shared UI feedback through the real application event pipeline.
          </p>
        </div>

        <section className="overflow-hidden rounded-lg border border-border bg-secondary/35">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-[14px] leading-[19px] font-semibold text-foreground">Activity Sonner</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Each button appends a dedicated test activity to the runtime journal. The global
              activity filter then projects it into the same Sonner bridge used by real work.
            </p>
          </div>
          <div className="divide-y divide-border">
            {TESTS.map((test) => (
              <div key={test.state} className="flex min-h-12 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-foreground">{test.label}</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">{test.description}</div>
                </div>
                <Button
                  type="button"
                  variant={test.variant}
                  disabled={pending !== null}
                  onClick={() => void trigger(test.state)}
                >
                  <test.icon className={pending === test.state ? 'animate-spin' : ''} />
                  {pending === test.state ? 'Triggering…' : test.label}
                </Button>
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-secondary/35">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-[14px] font-semibold text-foreground">Product activity journal</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Append real typed product facts. Each test should appear in both Office and the
              shared Sonner bridge; it never writes an Inbox message or News article.
            </p>
          </div>
          <div className="divide-y divide-border">
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground">Inbox received</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">Tests the registered Inbox activity producer and consumer.</div>
              </div>
              <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void triggerProductActivity('inbox')}>
                <Inbox />
                {pending === 'inbox' ? 'Triggering…' : 'Test Inbox'}
              </Button>
            </div>
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground">News ingested</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">Tests one per-item News fact without running an RSS fetch.</div>
              </div>
              <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void triggerProductActivity('news')}>
                <Newspaper />
                {pending === 'news' ? 'Triggering…' : 'Test News'}
              </Button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] leading-[18px] text-destructive">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  )
}
