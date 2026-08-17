# Plan: Agent runtime lifecycle log

**Status:** active  
**Owner guides:** [[docs/conversation-provenance.md]], [[docs/workspace-issues-and-scheduling.md]], [[docs/event-system.md]], [[docs/project-structure.md]]  
**Delivery:** serial PRs to `dev` (`area:workspace`, `area:ui`). Increment 1 is `review:deep` (new persisted shape). Open PR, do not merge.

## Goal

Workspace 是桌子，Session（`resumeId`）是员工。我们要一本 **agent runtime 生命周期日志**：能值班追溯，也能按时间重放「谁在哪张桌上、在不在干活」。以后虚拟办公室画面和桌宠动画都从这本日志读状态，不另造一套过程真相。

第一刀只落盘 + Office 时间线。办公室画面和宠物播放器是后续增量，但事件形状必须现在就按重放设计。

## Why a new log

现有三本账各管一件事，没有一本是「员工进出工位」的事件流：

| 现有 | 是什么 | 为什么不够 |
|---|---|---|
| `headless-tasks.json` | 一次出勤一行，会被改写 | 不是事件流；没有 TUI/WebPi |
| Session 名册 | 座位现在 `running` / `paused` | 只有当前态 |
| `agent-conversations.jsonl` | 问话派单 + 终态回复 | 是问话账本，不是进程生命周期 |

互拉只是 spawn 的一种 **cause**。日程 Issue、UI Play、HTTP headless、conversation ask 都应留下同一类 runtime 事件。

这本日志是审计投影，**不是**派单权威。不要用它复活已退役的 Alice event-bus（见 [[docs/event-system.md]]）。

## Decisions

1. **一本 append-only JSONL**，路径 `workspaces/state/agent-runtime.jsonl`（launcher-owned，和 headless-tasks / conversation log 同层）。新文件，无已发布形状，不用 migration。
2. **用现成 `createEventLog` 写盘**（seq / ts / type / payload / causedBy），path 指到上述文件。不要新建调度总线，不要让 journal 去拉起 Agent。
3. **占用 + headless 可消费转资产**。生灭仍记；headless 再记 `runtime.turn.text` / `tool` / `error`，完成态把 clipped assistant text + metrics 挂在 `runtime.stopped` 上。不记工具入参/出参、不记用户 prompt、不记 Inbox/交易正文。TUI 暂时没有对等的抽取器，有头 Session 仍只写占用。问话原文继续留在 `agent-conversations.jsonl`。
4. **身份用已有抽象**：`workspaceId` = 桌，`resumeId` = 员工。`taskId` / `sessionRecordId` 是这一次工位附件，不是人。
5. **cause 挂在 started / spawn_failed / rejected 上**，不单独再开互拉日志。
6. **顶级 Office**（`/office`，News 下方）。有头和无头 Agent 共用一本占用日志。单层 Activity Bar，不加第二层 sidebar。Automation 只留 Runs / API。`/automation/runtime` 重定向到 `/office`。Dev → Logs 的 conversation 表先不动。

### Alternatives considered

1. **只做 UI join 现有表** — 交互式 spawn、占班、`unavailable` 对不齐；也撑不起以后重放。否。
2. **把 conversation log 扩成万能日志** — 字段和名字都是问话；TUI 出生塞不进去。否。
3. **让 headless-tasks 兼事件流** — 会被改写的当前态当不了历史。否。
4. **第一刀就做办公室画面** — 没有可重放的事件流，画面只能猜当前名册。否；先日志。

### Event contract (replay-shaped)

每条：`seq`, `ts`, `type`, `payload`。payload 共用：

```ts
{
  workspaceId: string
  resumeId: string
  agent: string
  sessionRecordId?: string
  taskId?: string
  surface?: 'terminal' | 'webpi' | 'headless'
  cause?:
    | { kind: 'issue'; workspaceId: string; issueId: string }
    | { kind: 'conversation'; from?: { kind: 'session' | 'workspace' | 'human'; resumeId?: string; workspaceId?: string }; resolution?: 'exact' | 'reconstructed' }
    | { kind: 'ui' }
    | { kind: 'http' }
}
```

| type | 办公室语义 | 以后动画 |
|---|---|---|
| `session.born` | 员工入职（这张桌上出现一个人） | 入场 / idle |
| `runtime.started` | 坐上工位（terminal / webpi / headless） | working |
| `runtime.spawn_failed` | 想上工但进程没起来 | failed |
| `runtime.stopped` | 离开工位（done / failed / interrupted / paused） | review / failed / idle |
| `runtime.rejected` | 有人来找，人不可用，没派成（无 taskId） | waiting 落空 / 摇头 |
| `runtime.turn.text` | headless 吐出一条消息块 | talking |
| `runtime.turn.tool` | headless 开始/完成/失败一个工具（只有名和状态） | working |
| `runtime.turn.error` | headless 结构化错误块 | failed |

`causedBy` 指向导致这次 started 的上一条 seq（例如 born → started）。重放时按 seq 扫：每个 `resumeId` 保留最后一条 started/stopped，即可还原「此刻谁在干活」。

不在第一刀写 `runtime.occupied`：headless `started` 就是占班，`stopped` 就是释放。

### Write sites (increment 1)

| 事件 | 写入点 |
|---|---|
| `session.born` | `ProductSessionCoordinator.ensure` 在 `created: true` |
| `runtime.started` surface=headless | `dispatchHeadlessTask` 在 task 创建且即将 spawn 之后 |
| `runtime.spawn_failed` | headless 在 `processStarted === false` / `launchErrorCode` |
| `runtime.stopped` | headless 终态；PTY pause/stop；删除仍在跑的 Session；WebPi 非故意 exit |
| `runtime.started` terminal / webpi | interactive spawn 成功；**Play / `POST .../sessions/:sid/resume` 成功**（这是日常再拉起 TUI 的路径）；WebPi open 成功 |
| `runtime.rejected` | `conversation-control` 在 `unavailable`（以及同等的 Issue 评论回执失败且未派单） |
| `runtime.turn.*` | headless `onProgress` 对 structured blocks 做增量 diff（仅 headless） |
| `runtime.stopped` 完成资产 | headless 终态附 `assistantText` + `metrics` |

写失败只打 launcher warn，**不回滚派单**。日志不是事务参与者。

### UI (increment 1)

- 顶级 Office：只读时间线，最新在上，轮询或按 seq 增量。
- `/office`：无内层 sidebar。`/automation/runtime` 重定向到这里。
- 一行：时间、桌、员工 `@resumeId`、surface、type、cause、终态。
- 有 `taskId` 的可跳到同一条 Run。
- 空态说明这是工位进出，不是工具调用。
- demo handler 覆盖新 API。
- 不做办公室画布、不做宠物、不改 Runs 列模型。

### Out of scope (later increments)

- 虚拟办公室 2D/3D 画面（读这本日志做当前态 + 重放滑杆）。
- 桌宠 / Pet Lab 订阅同一事件映射到 Codex 行。
- 把 conversation prompt / 工具入参出参并进这本日志。
- 从 TUI / WebPi 抠消息块和工具。
- 历史回填（旧 headless-tasks 不迁移进 jsonl）。
- `unavailable` 以外的「想拉没拉成」枚举扩张。

## Increments

### 1. Log + Automation 时间线（本计划第一 PR，`review:deep`）

- [x] `AgentRuntimeLog`（或对 `createEventLog` 的薄封装）+ 类型守卫 + spec
- [x] 在上表写入点落盘；service 组装时打开 `<launcherRoot>/state/agent-runtime.jsonl`
- [x] `GET /api/agent-runtime?afterSeq=&limit=`（或 `/api/automation/runtime`）只读
- [x] 顶级 Office：`/office`、Activity Bar（News 下方）、i18n（en 为源，zh / zh-Hant / ja 补齐）、demo handler；`/automation/runtime` 重定向
- [x] 更新 [[docs/conversation-provenance.md]] 或 [[docs/workspace-issues-and-scheduling.md]] 一小节：日志是投影，派单权威不变
- [x] 本计划勾选与 [[PLANS.md]] 同步

### 1b. Headless turn assets（本增量）

- [x] `runtime.turn.text` / `tool` / `error` 类型 + 对 structured/progress 块的增量 diff
- [x] `dispatchHeadlessTask` 的 `onProgress` 串行写入；终态 `runtime.stopped` 带 assistantText/metrics
- [x] Office 时间线展示文本/工具/完成回复；demo handler 覆盖
- [x] owner guide + 本计划勾选

### 2–3. 办公室画面

已拆到 [[plans/office-floor.md]]。本计划不再扩地板/重放范围。

## Verification

Increment 1:

- `npx tsc --noEmit`
- `pnpm test`（至少覆盖：append/query、born/started/stopped/rejected、conversation unavailable 落盘、API 分页/`afterSeq`）
- `cd ui && npx tsc -b`
- demo：`pnpm -F open-alice-ui dev:demo` 走 `/office`
- 在 `petlab` 上：`conversation ask` 一条、停一条 headless，确认 jsonl 有 started+stopped，Automation 时间线看得到；`openalice status --home ~/.openalice` 仍是隔壁业主

## Completion

Increment 1 完成当且仅当：新 jsonl 在真实写入点产生事件、Office 只读展示、测试和 demo 覆盖、owner guide 写明「投影不是派单」。办公室画面未做不阻止勾选 Increment 1；整份计划在 Increment 3 或明确砍掉画面后删除。
