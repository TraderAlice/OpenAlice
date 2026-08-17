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
          Automation runs a native agent without an attached interactive
          Session: the same Workspace and tools, started <em>headless</em> by a
          trigger. Live progress and structured output appear under{' '}
          <span className="text-foreground">Runs</span>. A run can also publish a
          durable, user-facing report to the <span className="text-foreground">Inbox</span>.
          There are two ways a run starts.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">1 · Self-scheduled (the workspace declares it)</h3>
        <p className="text-muted-foreground">
          A workspace declares its work as <strong className="text-foreground">one
          markdown file per issue</strong> under{' '}
          <code className={CODE}>.alice/issues/&lt;id&gt;.md</code> in its own
          checkout (the filename stem is the issue id). Each file is YAML
          frontmatter plus one canonical markdown What. The file remains the
          source of truth whether it is managed from <span className="text-foreground">Issues</span>,{' '}
          <code className={CODE}>alice-workspace issue</code>, or edited directly.
          An issue with a{' '}
          <code className={CODE}>when</code> field self-schedules: a launcher
          scanner reads the dir and fires each due issue as a headless run. An
          issue <em>without</em> <code className={CODE}>when</code> is just a
          tracked work item on the Issue board (the scanner ignores it).
        </p>
        <Block>{`.alice/issues/morning-scan.md
---
title: Pre-market movers scan
status: todo
priority: high
assignee: "@new-then-resume"
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
            <code className={CODE}>assignee</code> <em>(optional)</em>: scheduled work defaults to{' '}
            <code className={CODE}>@new-then-resume</code>, which recruits one Session on the first run and then
            keeps that concrete owner for later runs. Use <code className={CODE}>@new-each-run</code>{' '}
            only when every fire should recruit a newcomer; an exact <code className={CODE}>@resumeId</code>{' '}
            continues that Session.
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
            <code className={CODE}>agent</code>, <code className={CODE}>model</code>, and{' '}
            <code className={CODE}>effort</code> optionally select the first or per-run native runtime
            for <code className={CODE}>@new-then-resume</code>/<code className={CODE}>@new-each-run</code>. An exact
            Session owner already owns that runtime tuple.
          </li>
          <li>
            The markdown below the closing <code className={CODE}>---</code> is the canonical{' '}
            <strong className="text-foreground">What</strong> and the exact scheduled prompt.
            Do not add a separate <code className={CODE}>what</code> frontmatter field.
          </li>
          <li>
            The scanner ticks about once a minute. Every attempt appears under Runs; user-facing
            reports may be published to the Inbox.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">2 · External trigger (POST a run)</h3>
        <p className="text-muted-foreground">Trigger a one-off headless run in a specific workspace over HTTP:</p>
        <Block>{`POST /api/workspaces/:id/headless
{
  "prompt": "<the instruction for the run>",
  "agent": "claude",      // optional; uses the saved default agent runtime
  "resumeId": "resume-…", // optional; continue an existing product conversation
  "timeoutMs": 1800000,   // optional
  "wait": false           // optional; true blocks for a fresh run only
}

  202  { "taskId": "...", "resumeId": "...", "status": "running" }
  429  { "error": "capacity", "message": "..." }`}</Block>
        <p className="text-muted-foreground">
          This is the seam for an external system (a webhook bridge, a cron on
          another host) to drive a workspace. Every run is recorded under{' '}
          <span className="text-foreground">Runs</span>. Keep the returned{' '}
          <code className={CODE}>resumeId</code> to continue the same accountable
          conversation in a later asynchronous request.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">Reporting back</h3>
        <p className="text-muted-foreground">
          Every headless run preserves its structured reply and tool activity under{' '}
          <span className="text-foreground">Runs</span>. For a durable handoff or
          report, publish to the Inbox with the{' '}
          <code className={CODE}>alice-workspace inbox push</code> CLI available on
          every Workspace&apos;s PATH. A no-change check may deliberately exit
          without creating Inbox noise.
        </p>
      </section>
    </div>
  )
}
