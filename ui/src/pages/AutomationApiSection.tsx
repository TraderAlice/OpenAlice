/**
 * Workspace automation — API reference (read-only docs). No interactive
 * try-it by design: triggering a run is a real side effect. Documents the two
 * ways an automation run starts (self-scheduled issue files + external POST)
 * and how a run reports back. This is the supported external execution surface;
 * the retired event-bus webhook route is not part of the architecture.
 */

const CODE = 'rounded bg-code-background px-1 py-0.5 font-mono text-[12px] text-foreground/90'

function Block({ children }: { children: string }) {
  return (
    <pre className="overflow-auto rounded bg-code-background p-3 text-[12px] leading-snug text-muted-foreground whitespace-pre-wrap">
      {children}
    </pre>
  )
}

export function AutomationApiSection() {
  return (
    <div className="max-w-prose mx-auto space-y-6 text-sm leading-relaxed">
      <section className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">Workspace automation</h2>
        <p className="text-muted-foreground">
          Automation is just a workspace run with no human attached: the same
          workspace, the same tools, spawned <em>headless</em> on a trigger. A run
          reaches you through the <span className="text-foreground">Inbox</span> — there
          is no other output channel. There are two ways a run starts.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">1 · Self-scheduled (the workspace declares it)</h3>
        <p className="text-muted-foreground">
          A workspace declares its work as <strong className="text-foreground">one
          markdown file per issue</strong> under{' '}
          <code className={CODE}>.alice/issues/&lt;id&gt;.md</code> in its own
          checkout (the filename stem is the issue id). Each file is YAML
          frontmatter plus a markdown body. An issue with a{' '}
          <code className={CODE}>when</code> field self-schedules: a launcher
          scanner reads the dir and fires each due issue as a headless run. An
          issue <em>without</em> <code className={CODE}>when</code> is just a
          tracked work item on the Issue board (the scanner ignores it). There is
          no central registry and no create API — it is a coding task (the agent
          edits the files).
        </p>
        <Block>{`.alice/issues/morning-scan.md
---
title: Pre-market movers scan
status: todo
priority: high
assignee: "@workspace"
when: { kind: cron, cron: "30 8 * * 1-5", timezone: America/New_York }
agent: claude
---

Every trading morning before the open, assemble the pre-market picture for
the watchlist — movers, gaps, and overnight headlines that move the thesis.
Write research/premarket.md, then run alice-workspace inbox push --doc
research/premarket.md --comments "Pre-market brief".`}</Block>
        <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
          <li>
            <code className={CODE}>title</code>: a short human title for the issue — required, surfaced
            on the Issue board and the Inbox.
          </li>
          <li>
            <code className={CODE}>status</code>: <code className={CODE}>backlog</code>,{' '}
            <code className={CODE}>todo</code>, <code className={CODE}>in_progress</code>,{' '}
            <code className={CODE}>done</code>, or <code className={CODE}>canceled</code>. For a scheduled
            issue this is also its on/off switch — it fires only while non-terminal; set it to{' '}
            <code className={CODE}>done</code>/<code className={CODE}>canceled</code> to silence the timer.
          </li>
          <li>
            <code className={CODE}>when</code> <em>(optional — present iff scheduled)</em>:{' '}
            <code className={CODE}>{`{kind: every, every: "30m"}`}</code>,{' '}
            <code className={CODE}>{`{kind: cron, cron: "0 9 * * 1-5", timezone: "local"}`}</code>, or{' '}
            <code className={CODE}>{`{kind: at, at: "2026-03-01T13:30:00Z"}`}</code>.
          </li>
          <li>
            Cron <code className={CODE}>timezone</code> is <code className={CODE}>local</code> for the
            machine&apos;s wall clock or an IANA zone such as <code className={CODE}>America/New_York</code>{' '}
            for market time. Omission is legacy-compatible machine-local time.
          </li>
          <li>
            <code className={CODE}>what</code>: a standalone prompt for the headless run — conditions
            live in the prompt, not the schedule. If omitted, the fire prompt falls back to the title plus the body.
          </li>
          <li>The scanner ticks about once a minute; runs report (or deliberately stay silent) via the Inbox.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">2 · External trigger (POST a run)</h3>
        <p className="text-muted-foreground">Trigger a one-off headless run in a specific workspace over HTTP:</p>
        <Block>{`POST /api/workspaces/:id/headless
{
  "prompt": "<the instruction for the run>",
  "agent": "claude",      // optional; uses the saved default agent runtime
  "timeoutMs": 1800000,   // optional
  "wait": false           // optional; true = block and return the run's result
}

  202  { "taskId": "..." }     // accepted, runs in the background (default)
  429                          // headless concurrency cap reached, retry later`}</Block>
        <p className="text-muted-foreground">
          This is the seam for an external system (a webhook bridge, a cron on
          another host) to drive a workspace. Every run is recorded under{' '}
          <span className="text-foreground">Runs</span>.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">Reporting back</h3>
        <p className="text-muted-foreground">
          A headless run has no UI. It surfaces results by pushing to the Inbox
          (the <code className={CODE}>alice-workspace inbox push</code> CLI, on every
          workspace's PATH). A run that produces a deliverable but never pushes
          leaves nothing behind — so a prompt should end by reporting, unless it
          was a check that deliberately found nothing to say.
        </p>
      </section>
    </div>
  )
}
