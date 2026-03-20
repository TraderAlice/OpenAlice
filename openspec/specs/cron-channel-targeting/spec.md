## Purpose

Allow cron jobs to deliver their output to a specific connector channel (e.g. "telegram", "web") instead of always using the last-interacted channel. This enables scenarios where scheduled market analysis goes to Telegram while interactive chat stays on the web UI.

## Requirements

### Requirement: Channel field on CronJob
The `CronJob` interface in `src/task/cron/engine.ts` SHALL include an optional `channel?: string` field. When set, the cron job's output SHALL be delivered to that specific connector channel.

### Requirement: Channel propagation through CronFirePayload
The `CronFirePayload` interface SHALL include the `channel?: string` field, propagated from the originating `CronJob`. The cron engine SHALL pass `job.channel` into the fire event payload.

### Requirement: Channel in CRUD operations
- `CronJobCreate` SHALL accept an optional `channel` field.
- `CronJobPatch` SHALL accept an optional `channel` field.
- The cron engine `add()` SHALL persist the channel value.
- The cron engine `update()` SHALL update the channel value when provided.

### Requirement: AI tool support
The `cronAdd` and `cronUpdate` AI tools SHALL expose a `channel` parameter described as "Deliver results to a specific connector channel (e.g. 'telegram', 'web'). Defaults to last-interacted." The tools SHALL pass the channel value through to the engine.

### Requirement: ConnectorCenter targeted delivery
`ConnectorCenter.notify()` and `ConnectorCenter.notifyStream()` SHALL accept a `channel` option in `NotifyOpts`. When `channel` is provided, the method SHALL look up the connector by name via `this.get(opts.channel)` instead of using the last-interacted fallback via `this.resolveTarget()`.

### Requirement: CronListener delivery
The `CronListener` SHALL pass `payload.channel` into the `connectorCenter.notify()` call's options, enabling the fired job's output to reach the intended channel.

### Requirement: API route support
The `POST /api/cron/jobs` route SHALL accept an optional `channel` field in the request body and pass it to `cronEngine.add()`.
