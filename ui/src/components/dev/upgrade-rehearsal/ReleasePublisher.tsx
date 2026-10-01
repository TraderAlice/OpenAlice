import { useState } from 'react'
import { Button } from '../../ui/button'
import {
  Collapsible,
  CollapsibleDetailsTrigger,
  CollapsibleContent,
} from '../../ui/collapsible'
import {
  identityLabel,
  type ReleaseChannel,
} from '@traderalice/update-lifecycle'
import { displayVersion, publicationStages, releaseAssets, type Publication } from './releases'
import type { Action } from './model'

export function ReleasePublisher({
  publication,
  dispatch,
}: {
  publication: Publication
  dispatch(a: Action): void
}) {
  const [channel, setChannel] = useState<ReleaseChannel>('stable')
  const candidate = publication.records
    .filter((r) => r.channel === channel)
    .at(-1)
  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">1. Publish a release</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Build a candidate, then make it discoverable. Nothing is published
            outside this rehearsal.
          </p>
        </div>
        <label className="text-xs text-muted-foreground">
          Release channel
          <select
            aria-label="Release channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as ReleaseChannel)}
            className="ml-2 rounded-lg border border-border bg-background p-2 text-sm text-foreground"
          >
            <option value="stable">Stable</option>
            <option value="beta">Beta</option>
            <option value="dev">Dev commit</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="break-all font-mono text-sm">
            {candidate ? displayVersion(identityLabel(candidate)) : 'No release yet'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {candidate
              ? `${publicationStages[candidate.stage]} · ${releaseAssets(candidate).length} artifacts`
              : 'Create the first candidate for this channel.'}
          </p>
        </div>
        {!candidate || candidate.stage === 3 ? (
          <Button onClick={() => dispatch({ type: 'publish', value: channel })}>
            Build next {channel === 'dev' ? 'commit' : channel}
          </Button>
        ) : (
          <Button
            onClick={() => dispatch({ type: 'advance', value: candidate.id })}
          >
            {
              ['', 'Verify candidate', 'Publish artifacts', 'Activate channel'][
                candidate.stage + 1
              ]
            }
          </Button>
        )}
      </div>
      <ol
        aria-label="Publication stages"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {publicationStages.map((title, i) => (
          <li
            key={title}
            className={`border-t-2 pt-2 text-xs ${candidate && i <= candidate.stage ? 'border-primary text-foreground' : 'border-border text-muted-foreground'}`}
          >
            {title}
          </li>
        ))}
      </ol>
      <Collapsible>
        <CollapsibleDetailsTrigger>
          Release history · {publication.records.length}
        </CollapsibleDetailsTrigger>
        <CollapsibleContent>
          <ul className="mt-3 space-y-3">
            {[...publication.records].reverse().map((r) => (
              <li key={r.id} className="border-t border-border pt-3 text-xs">
                <div className="flex flex-wrap justify-between gap-2">
                  <code className="break-all">{displayVersion(identityLabel(r))}</code>
                  <span>
                    {r.channel} · {publicationStages[r.stage]}
                    {publication.heads[r.channel] === r.id
                      ? ' · current head'
                      : ''}
                  </span>
                </div>
                <Collapsible>
                  <CollapsibleDetailsTrigger className="mt-2">
                    {releaseAssets(r).length} artifacts
                  </CollapsibleDetailsTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 max-h-48 overflow-auto">
                      {releaseAssets(r).map((name) => (
                        <code className="block break-all py-1" key={name}>
                          {name}
                        </code>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
