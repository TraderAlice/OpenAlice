# Plan: Product activity journal

**Status:** active

**Owner guides:** [[docs/event-system.md]], [[docs/conversation-provenance.md]], [[docs/ui-interaction-and-motion.md]], [[docs/project-structure.md]]

**Delivery:** existing `codex/office-workstation-crew` Draft PR to `dev`; do not merge until the Office topic is accepted.

## Goal

OpenAlice 后台完成了大量真实工作，但开发日志不能成为产品反馈。建立一本标准的、可被产品消费的 **Activity Journal**，让 Sonner 和 Office 从同一份追加式事实流中看到系统做了什么。

首期只登记三类产品活动；它们是启动时主动安装的 producer，不是 Journal
核心的固定领域：

1. `agent`：Session 与 runtime 生命周期、消息和工具进度；
2. `inbox`：一条 Inbox 内容完成持久化；
3. `news`：一条新闻完成去重并写入新闻归档。

Journal 是已发生事实的可回放投影，不是调度权威，也不恢复已退役的 Alice event bus。
TraderAlice 可以注册全部三类；NanoAlice 或未来通用 Alice 可以省略 Trading/News，
也可以由新模块注册自己的事件族，而不修改 Journal 核心。

## Product design

### Alternatives considered

1. **各页面独立轮询并直接弹 Sonner**：改动最小，但 Office 无法回放，Inbox、News 和 Agent 会形成三套通知旁路。否。
2. **每轮新闻抓取只写一条批次事件**：提示安静，但丢失单篇事实，无法做逐条日志、未读和后续重要性策略。否。
3. **统一逐条 Journal，消费者自行投影和聚合**：事实完整；Office 可回放；Sonner 可按注意力策略合并。采用。

### Extensibility model

- Journal 核心只认识通用 envelope、追加、查询、游标和 projection 注册；不 import News、Inbox 或 Trading 模块。
- 每个领域在启动时通过 `registerFamily()` 主动声明 family、事件类型和 payload guard，取得只允许该 family 写入的 recorder。
- producer 是否安装由产品配置决定。未安装的 family 不启动、不写入，也不要求通用 Alice 提供对应服务。
- 消费者按 family/type 注册 projector；未知或后来新增的事件在 Office 使用通用降级行，不会因为 UI 尚未认识而从日志消失。
- 注册只声明可写事实和显示元数据，不允许监听后反向启动任务；自动化仍归 Workspace issues / headless runs 所有。

### Interaction model

- Office 显示完整的 Agent、Inbox、News 时间线；非 Agent 事件使用系统身份，不伪造 Session 或工位。
- Sonner 只投影近期、有用户意义的活动。Inbox 与 News 提供“查看”动作，分别进入 Inbox 和 Market → News。
- News 每篇写一条事实。正常零星到达逐条提示；突发批量的聚合属于 Sonner 展示策略，不改变 Journal 粒度。
- 只有 Agent 生命周期事件参与 Office 工位占用投影。Inbox 和 News 不创建 NPC、不改变工作状态。
- 现有 Office 日志主从布局、键盘上下/Home/End 导航和窄屏层级保持不变；新增动作沿用现有可聚焦按钮和 Tab 导航。

## Journal contract

底层继续使用 `createEventLog`：单调 `seq`、时间戳、类型、结构化 payload、可选因果序号。`ProductActivityJournal.registerFamily()` 返回领域 recorder；底层 append 不作为任意业务模块可见的公共写入口。第一增量保留已发布的 `state/agent-runtime.jsonl` 文件和 `/api/agent-runtime` 兼容路由，在代码和产品层将其升级为 Product Activity Journal；后续若改物理路径，必须走幂等迁移。

事件只在领域事实已经持久化后写入；Journal 写入失败不得回滚 Inbox、News 或 Agent 主流程。

| family | types | product subject |
|---|---|---|
| agent | `session.born`, `runtime.*` | `workspaceId + resumeId` |
| inbox | `inbox.received` | `inboxEntryId` |
| news | `news.ingested` | `newsItemId + dedupKey` |

共同约束：

- payload 按事件类型验证，不把调试日志、凭证、完整 Prompt、工具参数或新闻正文写入 Journal；
- Inbox 只保存 Workspace、来源 Agent、条目 ID 和有界摘要；正文仍以 Inbox store 为真相；
- News 只保存文章 ID、标题、来源、链接、发布时间和去重键；正文仍以 News store 为真相；
- Inbox ID 和 News dedup key 是生产者级去重依据；前端以 Journal `seq` 保证一次提示。

## Ordered work

### 1. Standard journal foundation

- [x] 将现有 Agent-only 类型升级为 Agent / Inbox / News 的类型化产品活动契约
- [x] 增加主动 `registerFamily()` / scoped recorder，核心不依赖具体产品领域
- [x] 保留既有物理日志与 API 兼容边界，增加产品活动命名与 owner guide
- [x] 保证占用投影显式只接受 Agent 类型

### 2. Producers

- [x] Inbox 在 durable append 后写 `inbox.received`，覆盖所有真实写入路径
- [x] News 在去重并 durable ingest 后逐篇写 `news.ingested`
- [x] Collector 在 Workspace/Journal 就绪后启动，避免首次抓取事件丢失

### 3. Consumers

- [x] 全局活动 Hook 只消费统一 Journal，删除 Inbox 的并行轮询旁路
- [x] Sonner 消费 Inbox / News 活动并提供到对应产品页的可达动作
- [x] Office 日志为 Inbox / News 提供清晰标签、系统身份、详情和打开动作
- [x] Journal 按 family 独立分页，Agent 工具噪声不会把稀疏 Inbox / News 事件挤出频道
- [x] demo fixture 覆盖三类产品活动

### 4. Verification and delivery

- [x] Journal 类型守卫、持久化、占用排除测试
- [x] Inbox / News producer 测试
- [x] 全局活动投影、Sonner、Office UI 测试
- [x] `npx tsc --noEmit`
- [x] `cd ui && npx tsc -b`
- [x] `pnpm test`
- [x] 真实 `/office`、`/inbox`、`/market/news` 路由验证
- [x] 推送到现有 Office Draft PR，不合入 `dev`

## Live Office follow-up (2026-08-30)

- 用真实 Grok Issue 连续产生 155 次工具调用、Agent 里程碑、Inbox 送达和 News 入库后，
  Operations Board 的 `All` 最新 50 条只剩 Agent 事件；原先在客户端对这 50 条再筛选，
  导致 Inbox / News 标签错误显示为空。
- 对比扩大统一页面、给产品事件提权重排序、按 family 独立分页后，采用 family 分页：扩大
  页面仍会被长工具流耗尽，权重排序会破坏 Journal 顺序；family 页面既保留逐条事实，也不
  改变 `All` 的精确时间线。
- Journal 在恢复和追加时维护每个已注册 family 的有界近期页及准确总数；API 接受
  `family`，Office 每轮并行刷新 `All / Agent / Inbox / News` 四个独立页面。真实 Project
  复测为 `All 50 / Agent 50 / Inbox 4 / News 50`，Inbox #0823 在 1,295 条总日志与密集
  Agent 工具流之后仍可直接打开。
- 同一轮 Grok 测试还证明空间地标的旧 100 条全量窗口会在 remount 后丢掉稀疏提醒。
  Journal 因此也提供有界多类型查询；Office 地标每次只取最新 Agent 里程碑、Inbox 与
  News 各一条，而不消费工具流。真实触发 Inbox #1296 / News #1297 后，两处静态 `!`
  在整页重载后仍保留，直到各自的物理终端被打开。

## Completion

Agent、Inbox、News 都在领域事实落盘后进入同一条可回放 Journal；Office 能逐条查看三类活动；Sonner 不再旁路轮询 Inbox，并能提示 Inbox 与 News；非 Agent 活动不会污染工位投影。完成验收后删除本计划及 [[PLANS.md]] 条目，Git 历史作为归档。
