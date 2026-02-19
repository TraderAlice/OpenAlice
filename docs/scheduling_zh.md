# Scheduling Subsystem

Little Pony 的调度子系统，从 OpenClaw 的心跳/Cron/投递架构提取设计，重写实现。

## 设计哲学

1. **Scheduler 是唯一的闹钟** — 所有需要唤醒 agent 的事件（心跳、cron、手动触发）都通过 `scheduler.requestWake()` 汇聚
2. **Cron 不直接调用 agent** — Cron 往 system event 队列注入事件，然后唤醒 scheduler；agent 在正常对话上下文中看到这些事件
3. **Agent 自决策是否投递** — 通过 ack token（默认 `HEARTBEAT_OK`），agent 决定"没事可报"时抑制投递
4. **文件驱动** — Cron 任务持久化为 JSON，投递队列持久化为单文件，崩溃后可恢复
5. **模块隔离** — 5 个文件各管各的，通过 `main.ts` 粘合，不互相 import（除了 cron→agent-events、scheduler→agent-events）

## 文件清单

```
src/core/
  agent-events.ts       事件总线 + system event 队列
  scheduler.ts          心跳调度 + 唤醒合并 + active hours + ack token
  cron.ts               文件持久化的 cron 任务引擎
  delivery.ts           出站消息队列 + 重试 + 崩溃恢复
  connector-registry.ts 连接器注册 + "最后交互"投递路由
```

## 架构概览

```
            ┌──────────────┐
            │  Cron Engine │
            │  (定时任务)    │
            └──────┬───────┘
                   │ enqueueSystemEvent()
                   │ requestWake('cron')
                   ▼
┌──────────┐   ┌──────────────┐   ┌───────────────┐
│ Manual / │──▶│  Scheduler   │◀──│   Connector   │
│ Hook     │   │  (闹钟+合并)  │   │ touchInteraction()
└──────────┘   └──────┬───────┘   └───────────────┘
                      │
                      │ runOnce()
                      ▼
               ┌──────────────┐
               │    Engine     │
               │ askWithSession│
               │ (heartbeat    │
               │  session)     │
               └──────┬───────┘
                      │
                      │ stripAckToken()
                      ▼
              ┌───────────────┐
              │ 有内容要投递？  │
              │ shouldSkip?   │
              └───┬───────┬───┘
                  │no     │yes
                  ▼       ▼
           ┌──────────┐  (静默)
           │ Delivery  │
           │ enqueue() │
           │ deliver() │
           │ ack()     │
           └──────────┘
```

## 模块详解

### 1. Agent Events (`agent-events.ts`)

内存事件总线 + system event 队列，两个独立功能合在一个文件里。

**事件总线** — 纯观测用，不影响控制流：
```typescript
emit('heartbeat', { status: 'sent', reason: 'interval', durationMs: 1234 })
emit('delivery', { status: 'failed', channel: 'telegram', error: '...' })

// 订阅
const unsub = on((event) => console.log(event))
const unsub2 = onStream('heartbeat', (event) => { ... })
```

每个 stream 有独立的单调递增序号，用于排序和去重。

**System Event 队列** — cron→agent 的通信通道：
```typescript
// Cron 注入
enqueueSystemEvent({
  id: 'cron:abc:1234567890',
  source: 'cron',
  text: '检查 BTC 的 RSI',
  contextKey: 'cron:abc',  // 同 key 的事件会去重（新的替换旧的）
})

// Scheduler flush 时取出
const events = drainSystemEvents()  // 取出并清空
```

队列上限 50 条，超出时淘汰最旧的。无持久化 — 进程挂了 pending 的 system event 会丢失，但 cron 会重新触发。

### 2. Scheduler (`scheduler.ts`)

核心调度器，职责：
- 按间隔（如 30m）定时唤醒 agent
- 合并短时间内的多个唤醒请求（250ms 窗口）
- 执行 active hours 检查
- 调用 `runOnce` 回调

**创建：**
```typescript
const scheduler = createScheduler(
  { heartbeat: config.scheduler.heartbeat },
  runOnce,  // (opts) => Promise<HeartbeatResult>
)
```

**唤醒合并（Wake Coalescing）：**

250ms 内的多个 `requestWake()` 只触发一次执行，取最高优先级的 reason：

| Reason     | Priority | 来源                   |
|------------|----------|------------------------|
| `retry`    | 0        | 上次执行失败后自动重试    |
| `interval` | 1        | 心跳定时器              |
| `cron`     | 2        | Cron 任务触发           |
| `message`  | 2        | 用户消息（预留）         |
| `manual`   | 3        | 手动触发                |
| `hook`     | 3        | Webhook / 外部集成      |

示例：
```
t=0ms   requestWake('interval')   → pending = interval (pri 1)
t=50ms  requestWake('cron')       → pending = cron (pri 2, 升级)
t=250ms flush()                   → 执行一次, reason='cron'
```

**Active Hours：**

只对 `interval` 心跳生效。Cron、manual、hook 不受限制。

```json
{
  "activeHours": {
    "start": "09:00",
    "end": "22:00",
    "timezone": "Asia/Shanghai"
  }
}
```

支持跨午夜（如 `"22:00"` → `"06:00"`），支持 IANA 时区，`"local"` 使用系统时区。

**Ack Token 自决策：**

Agent 回复后，`stripAckToken()` 检查：
1. 回复为空 → `ok-empty`，不投递
2. 回复包含 ack token 且剩余文本 ≤ `ackMaxChars` → `ok-ack`，不投递
3. 有实质内容 → `sent`，走投递

默认 ack token 是 `HEARTBEAT_OK`，默认 `ackMaxChars` 是 300。Agent 的 prompt 里会告诉它：没事可报就回复 `HEARTBEAT_OK`。

**执行互斥：**

`running` 标志位保证同一时刻只有一个 `runOnce` 在执行。正在跑的时候来新的 wake 请求，会排队等当前执行完。

**失败自动重试：**

`runOnce` 抛异常后，1 秒后自动发起 `requestWake('retry')`（最低优先级，不会抢占正常调度）。

### 3. Cron (`cron.ts`)

文件驱动的定时任务引擎。

**三种调度类型：**

| Kind    | 格式                     | 说明           |
|---------|--------------------------|----------------|
| `at`    | ISO 时间戳               | 一次性，执行后自动禁用 |
| `every` | 持续时间 `"2h"`, `"30m"` | 周期执行         |
| `cron`  | 5 段 cron 表达式          | 标准 cron       |

**两种 session target：**

| Target     | 行为                                                |
|------------|-----------------------------------------------------|
| `main`     | 注入 system event + 唤醒 scheduler，agent 在主上下文中处理 |
| `isolated` | （预留）在独立 session 中运行，不影响主对话              |

**持久化：**

所有 job 存在一个 JSON 文件（默认 `data/cron/jobs.json`），原子写入（tmp + rename）。

**错误退避：**

连续失败时，next run 时间会加上退避：
```
第 1 次失败 → +30s
第 2 次失败 → +1m
第 3 次失败 → +5m
第 4 次失败 → +15m
第 5+ 次失败 → +60m
```

**Timer 漂移防护：**

`setTimeout` 对大数值不精确，所以 timer 最长 60 秒就重新计算一次 next fire time。

**Main session 触发流程：**
```
cron timer fires
  → executeJob(job)
    → enqueueSystemEvent({ source: 'cron', text: job.payload, contextKey: `cron:${job.id}` })
    → onWake('cron')  // = scheduler.requestWake('cron')
  → save()  // 更新 nextRunAtMs
  → armTimer()  // 重新设置下一个 timer
```

### 4. Delivery (`delivery.ts`)

文件驱动的出站消息队列。

**生命周期：**
```
enqueue()  →  写文件到 data/delivery-queue/{uuid}.json
deliver()  →  通过 connector 发送
ack()      →  删除文件
fail()     →  更新文件（retryCount++, lastError）
moveToFailed()  →  移到 data/delivery-queue/failed/ 子目录
```

**重试退避：**
```
第 1 次重试 → 5s
第 2 次重试 → 25s
第 3 次重试 → 2m
第 4 次重试 → 10m
超过 maxRetries（默认 5）→ 移到 failed/
```

**崩溃恢复：**

启动时 `recoverPending()` 扫描队列目录，按 `enqueuedAt` 排序，逐个重试。有时间预算（默认 60s），超时则推迟剩余条目。

**在 `runOnce` 中的使用：**
```typescript
// 先落盘（防丢）
const entryId = await enqueue(config, { channel, to, text })

// 再尝试即时投递
try {
  await target.deliver(text)
  await ack(config, entryId)      // 成功 → 删文件
} catch {
  // 失败 → 文件留着，下次启动 recoverPending() 会重试
}
```

### 5. Connector Registry (`connector-registry.ts`)

连接器注册表，解决"投递给谁"的问题。

**注册（Telegram 插件启动时）：**
```typescript
const unregister = registerConnector({
  channel: 'telegram',
  to: String(chatId),
  deliver: async (text) => { client.sendMessage({ chatId, text }) },
})
```

**记录交互（每次用户发消息时）：**
```typescript
touchInteraction('telegram', String(message.chatId))
```

**解析投递目标：**
```typescript
const target = resolveDeliveryTarget()
// → 返回最后 touchInteraction 的那个 connector
// → 如果没有交互记录，fallback 到第一个注册的 connector
// → 如果没有 connector，返回 null
```

设计意图：单租户多渠道。一个用户可能通过 Telegram、Discord、Webhook 等多个渠道可达，投递总是走最后交互的那个。以后加新 connector 不需要改调度逻辑。

## 配置

`data/config/scheduler.json`（所有字段都有默认值，文件不存在也能跑）：

```json
{
  "heartbeat": {
    "enabled": true,
    "every": "30m",
    "prompt": "Read HEARTBEAT.md and check if anything needs attention. Reply HEARTBEAT_OK if nothing to report.",
    "ackToken": "HEARTBEAT_OK",
    "ackMaxChars": 300,
    "activeHours": {
      "start": "09:00",
      "end": "22:00",
      "timezone": "Asia/Shanghai"
    }
  },
  "cron": {
    "enabled": true,
    "storePath": "data/cron/jobs.json"
  },
  "delivery": {
    "queueDir": "data/delivery-queue",
    "maxRetries": 5
  }
}
```

最小启用配置：
```json
{
  "heartbeat": { "enabled": true }
}
```

## 启动顺序

```
main()
  1. loadConfig()
  2. 初始化 trading / wallet / sandbox / brain
  3. new Engine(...)
  4. engine.use(TelegramPlugin)          ← 注册插件（还没 start）
  5. new SessionStore('heartbeat')       ← 心跳专用 session
  6. createScheduler(config, runOnce)    ← 心跳定时器开始跑
  7. createCronEngine(config, onWake)    ← 创建但不 start
  8. engine.start()
     8a. TelegramPlugin.start()          ← 连接 API, registerConnector()
     8b. engine.onReady()
         8b-i.  cronEngine.start()       ← 加载 jobs.json, arm timer
         8b-ii. recoverPending()         ← 扫描队列，重试失败的投递
     8c. while (!stopped) tick()         ← 进入主循环
```

`onReady` 保证：cron 和 delivery recovery 在 connector 注册之后才启动。

## 数据流

### 心跳流程
```
setInterval(30m)
  → requestWake('interval')
  → [250ms coalesce]
  → flush()
    → activeHours check (interval only)
    → drainSystemEvents()
    → runOnce({ reason, prompt, systemEvents })
      → engine.askWithSession(prompt, heartbeatSession)
      → stripAckToken(response)
      → if shouldSkip: return ok-ack
      → resolveDeliveryTarget()
      → enqueue() → deliver() → ack()
```

### Cron 流程
```
cron timer fires
  → enqueueSystemEvent({ source: 'cron', text: payload })
  → scheduler.requestWake('cron')
  → [250ms coalesce — 可能跟心跳合并]
  → flush()
    → drainSystemEvents() → 取出 cron 事件
    → runOnce({ systemEvents: [{source:'cron', text:'...'}] })
      → prompt 拼接: heartbeat prompt + system events
      → agent 看到完整消息，正常回复
      → strip + deliver (同心跳)
```

### 用户消息流程
```
Telegram message arrives
  → touchInteraction('telegram', chatId)    ← 记录最后交互
  → handleMessage() → engine.askWithSession()   ← 正常聊天
  → sendReply()                                  ← 直接回复

  (下次心跳/cron 触发投递时，会投到这个 chatId)
```

## 磁盘结构

```
data/
  config/
    scheduler.json          ← 调度配置
  sessions/
    heartbeat.jsonl         ← 心跳专用会话（JSONL 格式）
  cron/
    jobs.json               ← Cron 任务列表
  delivery-queue/
    {uuid}.json             ← 待投递条目
    failed/
      {uuid}.json           ← 超过重试次数的条目
```

## 测试

所有模块都有对应的 `.spec.ts` 文件，共 83 个测试用例：

| 文件                       | 测试数 | 关键技术                    |
|---------------------------|--------|----------------------------|
| `agent-events.spec.ts`    | 14     | 内存状态，`_resetForTest()` |
| `scheduler.spec.ts`       | 26     | `vi.useFakeTimers()`       |
| `cron.spec.ts`            | 15     | `mkdtemp` + 临时目录        |
| `delivery.spec.ts`        | 17     | `mkdtemp` + 临时目录        |
| `connector-registry.spec.ts` | 11  | 内存状态，`_resetForTest()` |

运行：
```bash
npx vitest run src/core/*.spec.ts
```

## 设计决策记录

### 为什么不用 BullMQ？
OpenAlice 是单进程应用，不需要 Redis 支持的分布式任务队列。Agent Events（84 行的 EventEmitter）+ 文件持久化已经满足需求。

### 为什么心跳和 cron 共用 scheduler？
OpenClaw 的设计：两条独立的触发线（cron timer + heartbeat interval）最终汇聚到同一个执行入口。共用 scheduler 天然支持唤醒合并 — cron 和心跳在同一个 250ms 窗口内只执行一次。

### 为什么 cron 通过 system event 注入而不是直接调用 agent？
保持 agent 的统一入口。Agent 不需要知道"这个 prompt 是心跳来的还是 cron 来的"，它就看到一条消息，正常处理。这让调度系统对 agent 完全透明。

### 为什么 delivery 要先写文件再发送？
防丢。`enqueue()` → `deliver()` → `ack()` 三步操作，任何一步挂了都不会丢消息。最坏情况：发送成功但 ack 之前进程挂了，下次启动会重发一次（at-least-once 语义）。

### 为什么用 "last interaction" 策略路由投递？
跟 OpenClaw 保持设计哲学统一。单租户场景下，用户最后在哪个渠道跟 bot 说话，bot 就在那个渠道回复。以后加新 connector 只需要 `registerConnector()` + `touchInteraction()`，不用改调度逻辑。
