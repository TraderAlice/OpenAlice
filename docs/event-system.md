# Event System Guide

Alice's async lifecycle runs on a typed pub-sub bus. Cron timers, connector
gateways, and external webhooks emit events; Listeners react to them and may
emit downstream events. **Read this before adding a new event type, Listener,
or Producer** — the system has a small amount of structure that's easy to
miss, and skipping steps silently works in dev but breaks in subtle ways
(missing validation, invisible in the Flow graph, forgery via webhook, etc.).

If the Flow tab on `/automation` is live, it's the best visual reference for
what's already there.

## The three primitives

**Event type** — a named, schema-validated payload shape. Declared in one
place: [AgentEvents](../src/core/agent-event.ts) (metadata + TypeBox schema +
optional `external: true`). Derived `AgentEventMap` gives you full TS
discriminated-union narrowing anywhere you hold an `EventLogEntry`.

**Listener** — reactive. Subscribes to one or more event types (or `'*'` for
all), runs a handler, optionally emits follow-up events. Owns its own
lifecycle; registers with the [ListenerRegistry](../src/core/listener-registry.ts).
Canonical example: [cron-router](../src/task/cron/listener.ts).

**Producer (Pumper)** — pure event source. Only emits, never subscribes.
Declared against the same registry. Canonical examples: [cron-engine](../src/task/cron/engine.ts)
(timer), [webhook-ingest](../src/connectors/web/web-plugin.ts) (HTTP),
[connectors](../src/core/connector-center.ts) (shared across every connector
plugin — Web chat, Telegram, future Discord/Slack/etc., all emit
`message.received` / `message.sent` through ConnectorCenter's single
`connectors` producer rather than declaring their own).

Listeners and Producers **share one name namespace** — a name cannot be both.
The registry enforces this at declare time.

## Mental model

```
            ┌─────────────┐
 Producers ─┤             │─ event-in  → Listener ─ event-out
  (timers,  │  EventLog   │
   HTTP,    │  (pub-sub)  │
   sockets) │             │
            └─────────────┘
```

- The EventLog is the bus — append-only JSONL, fanned out to subscribers.
- Every event has a monotonic `seq` + `ts`.
- Listener `ctx.emit` auto-fills `causedBy = parentEntry.seq` — you get a
  causal chain for free. Producers have no parent, so their emits have no
  `causedBy` unless the caller passes one explicitly.
- Wildcards (`subscribes: '*'` / `emits: '*'`) render as a directional halo
  in the Flow view instead of N concrete edges. Runtime schema validation
  still applies.
- The Flow view at `/automation` hides an event node on a side where it has
  no concrete edge — a pure input event only shows on the left, a terminal
  output only on the right. Wildcards count as auras, not concrete edges,
  for this decision.

## Reference files (keep open when working on this area)

| Concern | File |
|---|---|
| Event metadata + schemas | [src/core/agent-event.ts](../src/core/agent-event.ts) |
| Listener grammar (EventTypeSet, EmitSignature, ListenerContext) | [src/core/listener.ts](../src/core/listener.ts) |
| Producer types | [src/core/producer.ts](../src/core/producer.ts) |
| Registry (register / declareProducer / start / stop) | [src/core/listener-registry.ts](../src/core/listener-registry.ts) |
| EventLog itself | [src/core/event-log.ts](../src/core/event-log.ts) |
| Reference Listener (subscribe → agent → emit done/error) | [src/task/task-router/listener.ts](../src/task/task-router/listener.ts) |
| Reference Producer (timer) | [src/task/cron/engine.ts](../src/task/cron/engine.ts) |
| Webhook ingest gate | [src/connectors/web/routes/events.ts](../src/connectors/web/routes/events.ts) + [webhook-auth.ts](../src/connectors/web/routes/webhook-auth.ts) |
| Flow visualization | [ui/src/pages/AutomationFlowSection.tsx](../ui/src/pages/AutomationFlowSection.tsx) |
| Webhook docs UI | [ui/src/pages/AutomationWebhookSection.tsx](../ui/src/pages/AutomationWebhookSection.tsx) |

## Recipe: add a new event type

1. **Payload interface** — add to [agent-event.ts](../src/core/agent-event.ts)
   (top section).
2. **AgentEventMap** — add the `'name': YourPayload` line.
3. **TypeBox schema** — add a `YourSchema = Type.Object({ ... })`.
4. **AgentEvents metadata** — add the entry with `schema`, optional
   `external: true`, and a one-line `description` (surfaces in the Flow tab
   tooltip and in `/api/topology`).
5. **Tests** — add to `expectedTypes` in [agent-event.spec.ts](../src/core/agent-event.spec.ts)
   and add at least one positive `validateEventPayload` case.

Nothing else is required for a purely internal event — it's now a valid
target for any Listener's `subscribes` or `ctx.emit`.

## Recipe: add a new Listener

Copy the task-router pattern ([task-router/listener.ts](../src/task/task-router/listener.ts)):

```ts
const MY_EMITS = ['my.done', 'my.error'] as const  // `as const` is load-bearing — TS needs the literal tuple
type MyEmits = typeof MY_EMITS

export function createMyListener(opts: {
  registry: ListenerRegistry
  // ...other deps the handler needs
}): { listener: Listener<'my.trigger', MyEmits>; start(): Promise<void>; stop(): void } {
  const listener: Listener<'my.trigger', MyEmits> = {
    name: 'my-listener',
    subscribes: 'my.trigger',
    emits: MY_EMITS,
    async handle(entry, ctx) {
      // entry.payload is narrowed to MyTriggerPayload
      // ctx.emit only accepts 'my.done' | 'my.error', with matching payload types
      // causedBy auto-fills from entry.seq
      await ctx.emit('my.done', { ... })
    },
  }

  let registered = false
  return {
    listener,
    async start() { if (!registered) { opts.registry.register(listener); registered = true } },
    stop() { if (registered) { opts.registry.unregister(listener.name); registered = false } },
  }
}
```

Wire in [main.ts](../src/main.ts): `const x = createMyListener({ registry: listenerRegistry, ... }); await x.start();`
**Registration order matters** — call `x.start()` **before** `listenerRegistry.start()`,
or register lazily after (the registry handles both, but the idiom is
register-then-start).

Write a spec file mirroring [task-router/listener.spec.ts](../src/task/task-router/listener.spec.ts):
real `EventLog` + `ListenerRegistry`, mocked agentCenter / connectorCenter,
append the subscribed event and assert downstream events appeared.

### Subscribe / emit grammar cheatsheet

| Form | Meaning | Flow rendering |
|---|---|---|
| `subscribes: 'cron.fire'` | Single type | Concrete edge from left-column node |
| `subscribes: ['cron.fire', 'task.requested'] as const` | Enumerated tuple | N concrete edges |
| `subscribes: '*'` | All events | Left-side aura (no edges) |
| `emits` omitted | Emits nothing (ctx.emit is unusable) | No right-side edges |
| `emits: ['my.done', 'my.error'] as const` | Enumerated tuple | N concrete edges |
| `emits: '*'` | Any registered type | Right-side aura |

## Recipe: add a new Producer

Producers are **not** objects implementing an interface — they're a
declaration that returns a handle. Integrate into whatever module owns the
external trigger (timer, HTTP route, bot handler).

```ts
// In the module that owns the external source
const producer = listenerRegistry.declareProducer({
  name: 'my-source',
  emits: ['my.event'] as const,  // narrow declaration = concrete Flow edges
})

// Replace any direct eventLog.append with:
await producer.emit('my.event', { ... })

// Lifecycle
producer.dispose()  // call from the owning module's shutdown
```

**Special case: adding a new Connector plugin.** If you're wiring a new
Connector (Discord, Slack, IMAP, etc.), **do not** declare your own
`message.received` / `message.sent` producer. That pump is owned by
ConnectorCenter as a single shared `connectors` producer — your plugin
calls `ctx.connectorCenter.emitMessageReceived(...)` /
`ctx.connectorCenter.emitMessageSent(...)` at the points it observes
incoming / outgoing messages. The `channel` field on the payload carries
source attribution (`'web'` / `'telegram'` / ...). This keeps the Flow
graph clean (one producer node, not one per connector) and means new
connectors don't have to reinvent the lifecycle wiring each time.

When choosing `emits`:

- **Prefer a narrow tuple.** A wildcard producer renders as an aura, which
  hides *what it actually produces* from the Flow graph. Webhook-ingest is a
  deliberate exception because its real shape is "whatever is in the external
  allowlist"; even then the declaration is kept narrow
  (`['task.requested'] as const`) and extended by hand when a new external
  type lands.
- **Runtime validation still fires.** A wildcard emit rejects unregistered
  types; a narrow emit rejects anything not in the declared tuple.

## Recipe: open an event to HTTP (external trigger)

This is the step that's easiest to half-do. Four places to edit:

1. **Event metadata** — set `external: true` on the event in [AgentEvents](../src/core/agent-event.ts).
2. **Webhook-ingest producer** — extend the tuple in [web-plugin.ts](../src/connectors/web/web-plugin.ts):
   ```ts
   this.ingestProducer = ctx.listenerRegistry.declareProducer({
     name: 'webhook-ingest',
     emits: ['task.requested', 'my.external.event'] as const,  // ← add
   })
   ```
3. **Route type declaration** — matching tuple in [events.ts](../src/connectors/web/routes/events.ts):
   ```ts
   ingestProducer: ProducerHandle<readonly ['task.requested', 'my.external.event']>
   ```
4. **Admin docs** — add an entry to `EXTERNAL_DOCS` in
   [AutomationWebhookSection.tsx](../ui/src/pages/AutomationWebhookSection.tsx)
   with `summary`, `fields`, `example`, and optional `notes`. The Webhook
   tab renders this automatically for any type the topology API reports as
   `external: true`; without an entry it falls back to a minimal card.

Auth, `isExternalEventType`, and schema validation are already handled by
the `/api/events/ingest` route. Once the four steps above are done, callers
do:

```bash
curl -X POST http://localhost:3002/api/events/ingest \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"type":"my.external.event","payload":{...}}'
```

See also: [webhook auth config](../data/config/webhook.json) (seeded empty —
must add a token before `/ingest` will accept anything; otherwise it
default-denies with 503).

## Common pitfalls

- **Calling `eventLog.append` directly from new code.** Works at runtime but
  the event appears in the Flow graph with no producer — it looks orphaned
  and is invisible to introspection. Declare a Producer instead.
- **Forgetting `as const` on the emits tuple.** Without it, TS widens to
  `string[]` and `ctx.emit` loses its type constraint; you'll see runtime
  errors instead of compile errors.
- **Name collision between a Listener and a Producer.** Registry throws at
  declare time with `"already registered as a listener"` /
  `"already registered as a producer"`. Pick a different name.
- **Forgetting to update `agent-event.spec.ts` `expectedTypes`** — you'll
  get a single failing test with a clear diff, but it's a common miss.
- **Wildcard emit ≠ bypass.** `emits: '*'` still validates the type exists
  in `AgentEvents` at runtime. Emitting an unregistered type throws.
- **Producer emits don't auto-fill `causedBy`.** Producers have no parent
  event; if the caller wants causality threading, they pass it explicitly
  via `opts.causedBy`.
- **Opening to HTTP without extending the webhook-ingest producer.** The
  route gate (`isExternalEventType`) will pass, but the narrow-typed
  `ingestProducer.emit(type, ...)` will throw because the type isn't in
  its declared tuple. TS won't catch this unless you also update the
  `ingestProducer: ProducerHandle<...>` type in `events.ts`.
- **`dispose()` leaks.** Producers disposed on module shutdown free their
  name in the registry. Forgetting it means a subsequent init fails with a
  collision — mostly only visible in test suites that spin up/down.

## Debugging / observability

- **Flow tab** at `/automation` — live graph. Pulses when events fire.
- **`GET /api/topology`** — raw JSON of event types + listeners + producers.
  Useful when the Flow graph looks wrong: confirm the registry actually knows
  about your new thing.
- **`GET /api/events/stream`** — SSE of every event, raw.
- **`GET /api/events/recent?type=foo&limit=N`** — in-memory ring-buffer.
- **`event-metrics` listener** — a wildcard listener tracks per-type count +
  last-seen timestamp; see [src/task/metrics/](../src/task/metrics/).
