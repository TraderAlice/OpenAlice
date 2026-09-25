import type { ReactNode, Ref, UIEventHandler } from 'react'

/** One conversation canvas. Start is its welcome state, with no transcript yet. */
export function ConversationLayout({ welcome = false, header, children, composer, scrollRef, onScroll }: {
  welcome?: boolean
  header?: ReactNode
  children: ReactNode
  composer: ReactNode
  scrollRef?: Ref<HTMLDivElement>
  onScroll?: UIEventHandler<HTMLDivElement>
}) {
  return <div
    data-testid={welcome ? 'harness-landing-root' : undefined}
    data-slot="conversation-layout"
    className="conversation-shell @container/harness relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background text-foreground"
    style={{ containerName: 'harness conversation' }}
  >
    {header}
    <div
      ref={scrollRef}
      onScroll={onScroll}
      data-testid={welcome ? 'harness-landing-scroll' : undefined}
      className="conversation-messages oa-harness-scroll flex min-h-0 min-w-0 flex-1 justify-start overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-8 @min-[42rem]/harness:px-8 @min-[42rem]/harness:py-10"
    >
      <div
        data-testid={welcome ? 'harness-landing-stack' : undefined}
        className={`mx-auto w-full min-w-0 shrink-0 ${welcome ? 'my-auto max-w-[42rem]' : 'max-w-[46rem]'}`}
      >{children}</div>
    </div>
    <div className="conversation-composer-wrap relative min-w-0 shrink-0 px-3 pb-3 @min-[42rem]/harness:px-6 @min-[42rem]/harness:pb-5">
      <div className="mx-auto w-full max-w-[46rem]">{composer}</div>
    </div>
  </div>
}
